import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFirestoreStore, type Store } from "./store.ts";
import { registerTools } from "./tools.ts";
import { verifyGoogleServiceToken } from "./oidc.ts";
import { recategorizeAll, type RecategorizeReport } from "./recategorize.ts";
import { createFirestoreCategoryStore, createFirestoreLinkStore, createFirestoreSyncStore, createPlaidFromEnv } from "./syncStore.ts";
import { finishLink, LinkError, startLink, type FinishResult, type StartResult } from "./link.ts";
import { syncAll, type SyncReport } from "./sync.ts";

/**
 * Dinero MCP endpoint: read-only finance tools over Firestore.
 *
 * Auth here is the plan's fallback: one long random bearer token. Swap
 * `authenticate` for OAuth once the Google sign-in flow has been tested.
 */

export function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export type SyncRunner = () => Promise<SyncReport>;
export interface LinkRunner {
  start(opts: { itemId?: string; addTransactions?: boolean }): Promise<StartResult>;
  finish(linkToken: string): Promise<FinishResult>;
}

export interface AppOptions {
  /** Lets a trusted machine caller (Cloud Scheduler) run /sync, and only /sync, without the bearer token. */
  verifySchedulerToken?: (token: string) => Promise<boolean>;
  /** Recomputes categories. Present when Firestore is available. */
  recategorize?: (opts: { dryRun: boolean }) => Promise<RecategorizeReport>;
}

export function createApp(expectedToken: string, store: Store, runSync?: SyncRunner, link?: LinkRunner, opts: AppOptions = {}) {
  if (expectedToken.length < 32) {
    throw new Error("MCP_BEARER_TOKEN must be at least 32 characters");
  }
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const match = /^Bearer (.+)$/.exec(header);
    if (!match || !tokensEqual(match[1], expectedToken)) {
      res
        .status(401)
        .set("WWW-Authenticate", 'Bearer realm="dinero-mcp"')
        .json({ error: "unauthorized" });
      return;
    }
    next();
  };

  const authenticateSync = async (req: Request, res: Response, next: NextFunction) => {
    const match = /^Bearer (.+)$/.exec(req.header("authorization") ?? "");
    if (match && (tokensEqual(match[1], expectedToken) || (await opts.verifySchedulerToken?.(match[1])))) {
      next();
      return;
    }
    res.status(401).set("WWW-Authenticate", 'Bearer realm="dinero-mcp"').json({ error: "unauthorized" });
  };

  const buildServer = () => {
    const server = new McpServer({ name: "dinero", version: "0.1.0" });
    registerTools(server, store);
    return server;
  };

  // Stateless: a fresh server and transport per request.
  app.post("/mcp", authenticate, async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("mcp request failed", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Not an MCP tool on purpose: tools stay read-only. Trigger with
  // curl -X POST -H "Authorization: Bearer $TOKEN" <service-url>/sync
  let syncing = false;
  app.post("/sync", authenticateSync, async (_req, res) => {
    if (!runSync) {
      res.status(503).json({ error: "Plaid is not configured (PLAID_CLIENT_ID / PLAID_SECRET)." });
      return;
    }
    if (syncing) {
      res.status(409).json({ error: "A sync is already running." });
      return;
    }
    syncing = true;
    try {
      const report = await runSync();
      for (const i of report.items) {
        if (i.status !== "ok" && i.status !== "skipped_mock") console.warn(`sync: ${i.institution} ${i.status} ${i.error ?? ""}`.trim());
      }
      res.status(report.ok ? 200 : 207).json(report);
    } catch (err) {
      console.error("sync failed", err);
      res.status(500).json({ error: "Sync failed." });
    } finally {
      syncing = false;
    }
  });

  // Recompute categories from the rules. A dry run unless the body says {"apply": true}.
  let categorizing = false;
  app.post("/categorize", authenticate, async (req, res) => {
    if (!opts.recategorize) {
      res.status(503).json({ error: "Categorizing is not available." });
      return;
    }
    if (categorizing) {
      res.status(409).json({ error: "A categorize run is already in progress." });
      return;
    }
    categorizing = true;
    try {
      res.json(await opts.recategorize({ dryRun: req.body?.apply !== true }));
    } catch (err) {
      console.error("categorize failed", err);
      res.status(500).json({ error: "Categorize failed." });
    } finally {
      categorizing = false;
    }
  });

  // Bank linking via Plaid Hosted Link (see link.ts). Not MCP tools.
  const linkRoute = (fn: (body: Record<string, unknown>) => Promise<unknown>) => async (req: Request, res: Response) => {
    if (!link) {
      res.status(503).json({ error: "Plaid is not configured (PLAID_CLIENT_ID / PLAID_SECRET)." });
      return;
    }
    try {
      res.json(await fn((req.body ?? {}) as Record<string, unknown>));
    } catch (err) {
      if (err instanceof LinkError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error("link failed", err);
      res.status(500).json({ error: "Link failed." });
    }
  };
  app.post(
    "/link/start",
    authenticate,
    linkRoute(async (b) => {
      if (b.itemId !== undefined && typeof b.itemId !== "string") throw new LinkError("itemId must be a string.", 400);
      return link!.start({ itemId: b.itemId as string | undefined, addTransactions: b.addTransactions === true });
    }),
  );
  app.post(
    "/link/finish",
    authenticate,
    linkRoute(async (b) => {
      if (typeof b.linkToken !== "string" || !b.linkToken) throw new LinkError("linkToken is required.", 400);
      return link!.finish(b.linkToken);
    }),
  );

  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get("/mcp", authenticate, notAllowed);
  app.delete("/mcp", authenticate, notAllowed);

  return app;
}

if (import.meta.url === `file://${process.argv[1]}` || process.env.RUN_MAIN === "1") {
  const token = process.env.MCP_BEARER_TOKEN;
  if (!token) {
    console.error("MCP_BEARER_TOKEN is not set");
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 8080);
  const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? "dinero-3e826";
  const plaid = createPlaidFromEnv();
  const syncStore = createFirestoreSyncStore(projectId);
  const runSync: SyncRunner | undefined = plaid ? () => syncAll(plaid, syncStore) : undefined;
  const linkStore = createFirestoreLinkStore(projectId);
  const link: LinkRunner | undefined = plaid
    ? { start: (o) => startLink(plaid, linkStore, o), finish: (t) => finishLink(plaid, linkStore, t) }
    : undefined;
  const callerEmail = process.env.SYNC_CALLER_EMAIL;
  const audience = process.env.SYNC_AUDIENCE;
  const verifySchedulerToken =
    callerEmail && audience ? (t: string) => verifyGoogleServiceToken(t, { audience, email: callerEmail }) : undefined;
  const categoryStore = createFirestoreCategoryStore(projectId);
  const recategorize = (o: { dryRun: boolean }) => recategorizeAll(categoryStore, o);
  createApp(token, createFirestoreStore(projectId), runSync, link, { verifySchedulerToken, recategorize }).listen(port, () => console.log(`dinero-mcp listening on :${port}`));
}
