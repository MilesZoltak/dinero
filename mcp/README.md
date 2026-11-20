# dinero-mcp

Step 1 of `docs/overhaul-plan.md`: a bare-bones MCP endpoint used only to prove
that a Claude chat can authenticate to and call a tool. It exposes one tool,
`ping`, and holds no financial data.

Auth is the plan's fallback, a single bearer token read from `MCP_BEARER_TOKEN`
(at least 32 characters). The Google sign-in OAuth flow is not implemented yet.

## Run locally

```bash
npm install
MCP_BEARER_TOKEN=$(openssl rand -hex 32) npm run dev
npm test
```

## Deploy to Cloud Run

Use the same project as the rest of Dinero (`dinero-3e826`). The token lives in
Secret Manager and is never committed.

```bash
openssl rand -hex 32 | gcloud secrets create dinero-mcp-token --data-file=-
gcloud run deploy dinero-mcp --source mcp --region us-central1 \
  --allow-unauthenticated \
  --set-secrets MCP_BEARER_TOKEN=dinero-mcp-token:latest
```

`--allow-unauthenticated` only opens Cloud Run's own IAM gate. The app still
rejects every `/mcp` request without the bearer token. Grant the Cloud Run
service account `roles/secretmanager.secretAccessor` on the secret first if the
deploy complains.

## Test from Claude

Add a custom connector with the service URL plus `/mcp`, send the token as a
bearer token, then ask a chat to call `ping`. A `pong` reply means step 1 works
for bearer auth.

## Plaid sync

`POST /sync` pulls accounts and transactions from Plaid into Firestore using
`/transactions/sync`: the first run fetches all history Plaid has, later runs
are incremental from a cursor stored on each `plaidItems` document. It is an
HTTP endpoint, not an MCP tool, so the MCP tools stay read-only.

There is no mock mode. Without Plaid credentials it returns 503. Items whose
token starts with `mock_` (from the old app) are skipped and reported. One bank
failing, for example `login_required` after an expired login, does not stop the
others; the response is 207 with a per-bank status. Re-link that bank to fix it.

Store the Plaid credentials in Secret Manager, then mount them:

```bash
printf '%s' "<client id>" | gcloud secrets create plaid-client-id --data-file=-
printf '%s' "<secret>"    | gcloud secrets create plaid-secret --data-file=-
gcloud run services update dinero-mcp --region us-central1 \
  --update-secrets PLAID_CLIENT_ID=plaid-client-id:latest,PLAID_SECRET=plaid-secret:latest \
  --update-env-vars PLAID_ENV=production
```

The service account needs `roles/secretmanager.secretAccessor` on both secrets
and `roles/datastore.user` (write access) on the project. Run a sync:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" https://<service-url>/sync
```

## Linking and re-linking banks

Uses Plaid Hosted Link: Plaid serves the sign-in screen, so there is no
frontend to host. Three cases, all `POST` with the bearer token:

```bash
# Expired login (status login_required in the /sync report): update mode
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"itemId":"<itemId from the sync report>"}' https://<service-url>/link/start

# Add transaction access to an investments-only bank (status balances_only)
curl -s -X POST ... -d '{"itemId":"<itemId>","addTransactions":true}' https://<service-url>/link/start

# A brand-new bank
curl -s -X POST ... -d '{}' https://<service-url>/link/start
```

Open the returned `hostedLinkUrl` in a browser and sign in to the bank. When
Plaid says you are done, finish the session with the returned `linkToken`:

```bash
curl -s -X POST ... -d '{"linkToken":"<linkToken>"}' https://<service-url>/link/finish
```

For a new bank this exchanges and stores the connection. For update mode it adds
nothing; the existing connection simply works again. Then run `POST /sync`.

Use update mode for expired logins. Linking the same bank as "new" creates a
second connection with a second copy of every account.

If `/link/start` says Hosted Link is not enabled, turn it on in the Plaid
dashboard. OAuth banks (Chase, Schwab, Fidelity) may also need an allowed
redirect URI registered there.
