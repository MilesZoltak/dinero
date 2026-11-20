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

## Proposed, not yet confirmed by Miles

These came out of a voice conversation; he agreed to "one vendor" but did not sign off on each piece. Confirm before building something expensive on top of them.

- **Cloud SQL for Postgres** instead of Firestore. Finance data is aggregation-heavy (spend by category, trends, net worth over time, recurring charges). Firestore is poor at that, which is why `src/lib/chatbot/tools.ts` loads every transaction and filters in memory. Cloud SQL has no free tier, so expect a small monthly cost. Firestore remains the fallback if cost matters more than query ergonomics.
- **Cloud Run** for a single small TypeScript service that does Plaid sync and webhooks, serves the Plaid Link page, and hosts the MCP endpoint.
- **Secret Manager** for the Plaid client id and secret. Encrypt Plaid access tokens at rest. Tokens must never be readable through any MCP tool.
- **Read-only MCP server** with purpose-built, parameterized tools returning plain rows, for example `get_accounts_summary`, `query_transactions`, `spend_by_category`, `monthly_trend`, `net_worth_history`, `recurring_charges`. No raw SQL tool.
- **Dashboard as live queries against that connector.** The Claude Data dashboard type runs each query in the reader's browser with the reader's own access, and its instructions say not to copy query rows into the artifact store. So Postgres stays the single source of truth and nothing financial is warehoused in Claude. Rows should be objects per row so the dashboard can load them directly. There is no refresh timer; data refreshes when the dashboard is opened, so Plaid sync runs server-side on its own schedule.

## Unverified, prove these first

1. **Connector auth.** Auth for the connector is meant to be Google sign-in over OAuth so there is no token to carry around. It has NOT been verified that Claude's custom connectors accept that flow cleanly. **First task: stand up a bare-bones MCP function with a login test and prove a Claude chat can call it.** Do not build the schema or port Plaid until this works. If it fails, fall back to a single long random bearer token stored in Secret Manager.
2. Whether a Claude dashboard can call a custom connector as a live dataset in practice (the docs say it can call tools on the viewer's connectors; this is untested here).
3. HIPAA and BAA coverage matters only for the dbt app, not Dinero. Google lists Firestore, Cloud Run and Cloud Storage as covered services, but that was stated from memory and should be checked against Google's current covered-services list before relying on it.

## Security problems in the current code (fix or retire during the rewrite)

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
