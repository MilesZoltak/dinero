# Dinero overhaul plan

Handoff from a planning chat in the Claude app to Claude Code. Read this before touching the code. It separates what Miles decided, what is a leaning, and what is still unverified, so don't treat the second and third as settled.

## Goal

A personal finance setup that Miles can use through Claude:

1. A **dashboard inside Claude** (the Claude "Data" dashboard artifact type).
2. A **tool Claude chats can call** (an MCP server exposed as a custom connector), so any chat can query his finances.

The existing Next.js web app is considered janky and was largely generated with Antigravity. A rewrite is welcome; salvage what is good.

## Decided (stated by Miles)

- **Minimize the secrets and plumbing he has to manage.** Prefer managed OAuth and built-in integrations over pasted tokens.
- **Keep third-party services down: one vendor.** That vendor is Google Cloud. Firebase and Google Cloud stay for his other apps (the dbt app, Foamies).
- **Minimal code in GitHub.** He is fine moving into Claude Code for the implementation.
- **Keep Firestore.** Decided on 2026-11-20 after weighing Cloud SQL: the small monthly Cloud SQL cost is not worth it. Aggregations run in the MCP service over date-bounded Firestore reads. Revisit only if data volume makes that slow.
- **Same repo.** The rewrite lives in this repo, under `mcp/`. Changes go through PRs because `main` auto-deploys.

## Proposed, not yet confirmed by Miles

These came out of a voice conversation; he agreed to "one vendor" but did not sign off on each piece. Confirm before building something expensive on top of them.

- ~~Cloud SQL for Postgres~~ Rejected, see Decided. Firestore stays.
- **Cloud Run** for a single small TypeScript service that does Plaid sync and webhooks, serves the Plaid Link page, and hosts the MCP endpoint.
- **Secret Manager** for the Plaid client id and secret. Encrypt Plaid access tokens at rest. Tokens must never be readable through any MCP tool.
- **Read-only MCP server** with purpose-built, parameterized tools returning plain rows, for example `get_accounts_summary`, `query_transactions`, `spend_by_category`, `monthly_trend`, `net_worth_history`, `recurring_charges`. No raw SQL tool.
- **Dashboard as live queries against that connector.** The Claude Data dashboard type runs each query in the reader's browser with the reader's own access, and its instructions say not to copy query rows into the artifact store. So Postgres stays the single source of truth and nothing financial is warehoused in Claude. Rows should be objects per row so the dashboard can load them directly. There is no refresh timer; data refreshes when the dashboard is opened, so Plaid sync runs server-side on its own schedule.

## Unverified, prove these first

1. ~~**Connector auth.**~~ **Done (2026-11-20), with the fallback.** A Claude chat called `ping` on the Cloud Run service `dinero-mcp` using a single bearer token stored in Secret Manager (`dinero-mcp-token`). In the custom connector dialog, choose "No sign-in" and add a request header `Authorization: Bearer <token>`. Google sign-in OAuth was not tried. Google's OAuth does not offer dynamic client registration, so it would probably need an authorization layer in front. For a single-user tool the bearer token is acceptable. Rotate it by adding a Secret Manager version and redeploying.
2. Whether a Claude dashboard can call a custom connector as a live dataset in practice (the docs say it can call tools on the viewer's connectors; this is untested here).
3. HIPAA and BAA coverage matters only for the dbt app, not Dinero. Google lists Firestore, Cloud Run and Cloud Storage as covered services, but that was stated from memory and should be checked against Google's current covered-services list before relying on it.

## Status

- Done: `mcp/` service with `ping`, `get_accounts_summary`, `query_transactions`, `spend_by_category` and `monthly_trend`, read-only over Firestore, with explicit field whitelists so Plaid tokens cannot appear in any response.
- Not built: `net_worth_history` (Dinero stores no balance history, so it needs a snapshot job first) and `recurring_charges`.
- Built, untested against real Plaid: `POST /sync` in `mcp/` (see `mcp/README.md`). Real Plaid only, cursor-based `/transactions/sync` with full-history paging, per-bank status report, no mock path. Needs Plaid secrets in Secret Manager and Firestore write access for the service account.
- First real sync run on 2026-11-20: Chase, Bank of America and Marcus synced real data (880, 56 and 8 transactions). The earlier worry that Firestore held mock data was wrong. Stanford FCU returned `ITEM_LOGIN_REQUIRED` and needs re-linking. Schwab and Fidelity returned `ADDITIONAL_CONSENT_REQUIRED`: they were linked with the Investments product only, so balances sync but transactions do not (now reported as `balances_only`).
- The first run replayed all history as "added" and overwrote categories on transactions the app already held. Fixed afterwards: existing categories are no longer overwritten. The old app's retroactive sweep (Spend page) restores rule-based categories.
- Not built: the Plaid Link page (needed to link real banks, and to re-link expired ones), the categorizer port, encrypting access tokens at rest, a sync schedule, and the dashboard.
- The old `get_spending_by_category` in `src/lib/chatbot/tools.ts` was wrong: it asked for 1000 rows but `queryTransactionsTool` clamps to 50, so category totals covered only 50 transactions. The `mcp/` version aggregates every transaction in the range.

## Security problems in the current code (fix or retire during the rewrite)

**Fixed in the lockdown change, pending merge:** every `/api/*` handler now calls `requireUser` (`src/lib/serverAuth.ts`), which verifies the Firebase ID token against Google's keys, requires a verified email, and checks it against an allowlist. `?bypassAuth=true` is removed. The dashboard sends the token through `authFetch`. The checks live in the handlers, not `proxy.ts`, so they do not depend on whether Firebase's Next adapter runs a proxy file.

**One manual step before merging:** the allowlist is a Firestore document, kept out of the public repo. Create `config/auth` with a field `allowedEmails` (array of strings) in the `dinero-3e826` Firestore, or nobody can use the dashboard. The check fails closed, so a missing document means 403 for everyone. The list is cached for 60 seconds.

The original findings, for the record:

- **No server-side auth on any API route.** Login is client-side only (`onAuthStateChanged` in `src/app/dashboard/layout.tsx`). `/api/accounts`, `/api/transactions`, `/api/plaid/*` and the rest are open to anyone who has the URL, including Plaid sync triggers.
- **`?bypassAuth=true`** disables the dashboard guard.
- **Plaid access tokens** live in the same unprotected data path (Firestore `plaidItems`).
- The repo is public. `data/db.json` is currently empty and no secrets are committed; keep it that way. The Firebase web config in `apphosting.yaml` is public-by-design client config, but nothing else should be added there.
- `main` auto-deploys to production through `.github/workflows/deploy.yml`. Use PRs.

## Salvage versus drop

Keep or port:
- Plaid link-token, token-exchange and sync logic (`src/app/api/plaid/*`, `src/lib/plaidClient.ts`)
- Categorizer and merchant normalization (`src/lib/categorizer.ts`, `src/lib/merchant.ts`)
- Data types in `src/lib/db.ts` (`Account`, `Transaction`, `PlaidItem`, `CategoryRule`). Convention: positive amount is an expense, negative is income.
- The three existing tool functions in `src/lib/chatbot/tools.ts`, as the seed of the MCP tools

Drop:
- The Next.js dashboard pages and Chart.js UI (replaced by the Claude dashboard)
- The Gemini chat sidebar and `/api/chat` (replaced by Claude through the connector)
- The Firestore and local `db.json` dual adapter
- Firebase Auth client login

Note: `AGENTS.md` warns that this Next.js version has breaking changes and to read `node_modules/next/dist/docs/` first. That only matters if any Next.js code is kept; the Link page can be a single static page.

## Suggested order

1. Prove connector auth with a bare-bones MCP endpoint (see Unverified, item 1).
2. Postgres schema and migrations; port the Plaid sync and categorizer.
3. Real MCP tools over that schema, read-only, then use them from a Claude chat.
4. Static Plaid Link page, including re-auth for expired bank logins.
5. Claude dashboard built from live queries against the connector.
6. Lock down or delete the old Next.js app and its open API routes.

## Open questions for Miles

- Same repo (this plan on a branch) or a fresh repo for the rewrite? He has been talking about "putting an md in dinero", so default to this repo unless told otherwise.
- Is the small monthly Cloud SQL cost acceptable, or should Firestore stay?
