import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFirestoreStore, type Store } from "./store.ts";
import { registerTools } from "./tools.ts";

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

export function createApp(expectedToken: string, store: Store) {
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
  createApp(token, createFirestoreStore(process.env.GOOGLE_CLOUD_PROJECT ?? "dinero-3e826")).listen(port, () => console.log(`dinero-mcp listening on :${port}`));
}
