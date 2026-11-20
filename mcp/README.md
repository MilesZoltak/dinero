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
