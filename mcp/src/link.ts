/**
 * Bank linking through Plaid Hosted Link: Plaid serves the sign-in screen, so
 * there is no frontend here. start -> open the URL in a browser -> finish.
 *
 * - New bank:            start {}
 * - Expired login:       start { itemId }                       (update mode)
 * - Add transactions to  start { itemId, addTransactions: true } (extra consent)
 *   an investments-only item
 */

export interface LinkPlaidLike {
  linkTokenCreate(req: Record<string, unknown>): Promise<{
    data: { link_token: string; expiration?: string; hosted_link_url?: string };
  }>;
  linkTokenGet(req: { link_token: string }): Promise<{
    data: {
      link_sessions?: {
        finished_at?: string | null;
        exit?: { error?: { error_code?: string } | null } | null;
        results?: {
          item_add_results?: {
            public_token: string;
            institution?: { name?: string; institution_id?: string } | null;
          }[];
        } | null;
      }[];
    };
  }>;
  itemPublicTokenExchange(req: { public_token: string }): Promise<{
    data: { access_token: string; item_id: string };
  }>;
}

export interface LinkStore {
  getPlaidItem(itemId: string): Promise<{ accessToken: string } | null>;
  listInstitutionNames(): Promise<string[]>;
  savePlaidItem(item: { itemId: string; accessToken: string; institutionId: string; institutionName: string }): Promise<void>;
}

export class LinkError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 502,
  ) {
    super(message);
  }
}

export interface StartResult {
  mode: "new" | "update" | "add_transactions";
  hostedLinkUrl: string;
  linkToken: string;
  expiration: string | null;
}

export async function startLink(
  plaid: LinkPlaidLike,
  store: LinkStore,
  opts: { itemId?: string; addTransactions?: boolean },
): Promise<StartResult> {
  const req: Record<string, unknown> = {
    user: { client_user_id: "dinero-owner" },
    client_name: "Dinero",
    country_codes: ["US"],
    language: "en",
    hosted_link: { url_lifetime_seconds: 1800 },
  };
  let mode: StartResult["mode"] = "new";

  if (opts.itemId) {
    const item = await store.getPlaidItem(opts.itemId);
    if (!item || !item.accessToken || item.accessToken.startsWith("mock_")) {
      throw new LinkError("No real Plaid item with that id.", 404);
    }
    req.access_token = item.accessToken; // update mode: no products allowed
    if (opts.addTransactions) {
      req.additional_consented_products = ["transactions"];
      mode = "add_transactions";
    } else {
      mode = "update";
    }
  } else {
    req.products = ["transactions"];
    req.optional_products = ["investments"];
  }

  let res;
  try {
    res = await plaid.linkTokenCreate(req);
  } catch (err) {
    const e = err as { response?: { data?: { error_code?: string; error_message?: string } } };
    throw new LinkError(`Plaid refused: ${e.response?.data?.error_code ?? "unknown"} ${e.response?.data?.error_message ?? ""}`.trim(), 502);
  }
  if (!res.data.hosted_link_url) {
    throw new LinkError("Plaid returned no hosted link URL. Hosted Link may not be enabled for this account.", 502);
  }
  return { mode, hostedLinkUrl: res.data.hosted_link_url, linkToken: res.data.link_token, expiration: res.data.expiration ?? null };
}

export interface FinishResult {
  finished: boolean;
  exitedWithError: string | null;
  added: { itemId: string; institution: string; warning?: string }[];
  errors: string[];
}

/**
 * Reads the outcome of a Hosted Link session. New banks come back as a public
 * token, which is exchanged and stored. Update-mode sessions add nothing; the
 * existing item simply works again, so run a sync afterwards.
 */
export async function finishLink(plaid: LinkPlaidLike, store: LinkStore, linkToken: string): Promise<FinishResult> {
  let sessions;
  try {
    sessions = (await plaid.linkTokenGet({ link_token: linkToken })).data.link_sessions ?? [];
  } catch {
    throw new LinkError("Plaid could not find that link token (expired or wrong).", 404);
  }

  const out: FinishResult = { finished: false, exitedWithError: null, added: [], errors: [] };
  const known = new Set((await store.listInstitutionNames()).map((n) => n.toLowerCase()));

  for (const s of sessions) {
    if (s.finished_at) out.finished = true;
    if (s.exit?.error?.error_code) out.exitedWithError = s.exit.error.error_code;
    for (const r of s.results?.item_add_results ?? []) {
      const name = r.institution?.name ?? "Unknown institution";
      try {
        const ex = await plaid.itemPublicTokenExchange({ public_token: r.public_token });
        await store.savePlaidItem({
          itemId: ex.data.item_id,
          accessToken: ex.data.access_token,
          institutionId: r.institution?.institution_id ?? "",
          institutionName: name,
        });
        out.added.push({
          itemId: ex.data.item_id,
          institution: name,
          ...(known.has(name.toLowerCase())
            ? { warning: "This bank was already linked. Its accounts may now appear twice; use update mode for expired logins." }
            : {}),
        });
      } catch (err) {
        const e = err as { response?: { data?: { error_code?: string } } };
        out.errors.push(`${name}: ${e.response?.data?.error_code ?? "exchange failed"}`);
      }
    }
  }
  return out;
}
