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

For a new bank this exchanges and stores the connection. For update mode the
result lists the repaired item with `"relinked": true` and the connection works
again. Then run `POST /sync`.

Use update mode for expired logins. Linking the same bank as "new" creates a
second connection with a second copy of every account.

If `/link/start` says Hosted Link is not enabled, turn it on in the Plaid
dashboard. OAuth banks (Chase, Schwab, Fidelity) may also need an allowed
redirect URI registered there.

## Daily sync schedule

Cloud Scheduler calls `POST /sync` with a Google-signed identity token for a
dedicated service account, so the bearer token is never copied into the
scheduler. The service accepts that identity for `/sync` only; it cannot reach
`/mcp` or `/link/*`. It is enabled by two environment variables:

- `SYNC_CALLER_EMAIL`: the service account the scheduler runs as
- `SYNC_AUDIENCE`: the service URL, which must match the scheduler's audience exactly

```bash
gcloud services enable cloudscheduler.googleapis.com --project dinero-3e826
gcloud iam service-accounts create dinero-sync --project dinero-3e826 --display-name "Dinero daily sync"

gcloud run services update dinero-mcp --project dinero-3e826 --region us-central1 \
  --update-env-vars SYNC_CALLER_EMAIL=dinero-sync@dinero-3e826.iam.gserviceaccount.com,SYNC_AUDIENCE=https://dinero-mcp-296300418387.us-central1.run.app

gcloud scheduler jobs create http dinero-sync --project dinero-3e826 --location us-central1 \
  --schedule "0 6 * * *" --time-zone "America/Los_Angeles" \
  --uri https://dinero-mcp-296300418387.us-central1.run.app/sync --http-method POST \
  --oidc-service-account-email dinero-sync@dinero-3e826.iam.gserviceaccount.com \
  --oidc-token-audience https://dinero-mcp-296300418387.us-central1.run.app \
  --attempt-deadline 600s
```

Run it now to test: `gcloud scheduler jobs run dinero-sync --location us-central1 --project dinero-3e826`.

A bank that needs a fresh login does not make the job fail: the response is 207
and the service logs a `sync: <bank> login_required` warning. The dashboard
shows accounts that have not synced in over 7 days.

## Categories

Ported from the old app's categorizer (`mcp/src/categorize.ts`). A transaction's
category comes from, in order:

1. Your category rules (Firestore `categoryRules`): the **longest** matching
   pattern wins. The old app took whichever rule Firestore listed first.
2. Plaid's own category, shown under a readable name (`FOOD_AND_DRINK` becomes
   `Food & Drink`). Plaid categories with no standard equivalent keep their own
   name, such as Medical or Entertainment, instead of becoming "Other".
3. The category it already had, then `Other`.

New transactions are categorized as they sync, and Plaid's original category is
kept in `plaidCategory`. `categorySource` records where a category came from:
`rule`, `plaid`, `existing`, `default` or `manual`. Rows marked `manual` are never
changed by a sweep, ready for a future write tool.

To recompute every existing transaction:

```bash
# Preview: changes nothing and shows counts and a sample
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' https://<service-url>/categorize

# Apply
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"apply":true}' https://<service-url>/categorize
```

Rows synced before `plaidCategory` existed don't have it. To backfill it,
replay all history once. Existing categories are not changed; this needs the
bearer token (the scheduler cannot do it):

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"resetCursors":true}' https://<service-url>/sync
```

Default rules are seeded only when there are no rules at all, so a rule you
deleted stays deleted. `spend_by_category` and `monthly_trend` leave out the
`Transfer` category unless `includeTransfers` is true.

## Write tools

With `DINERO_WRITE_TOOLS=on`, the connector also offers tools that change
categories. Without that variable they are not registered at all, so removing
it turns them off without a code change.

- `list_category_rules` (read-only): every rule with how many transactions it wins.
- `set_transaction_category`: sets one transaction's category and marks it
  `manual`, so sweeps never change it. `category: null` returns it to automatic,
  restoring the category the manual edit replaced.
- `add_category_rule` and `delete_category_rule`: preview by default, showing
  how many transactions would change and a sample. Only `confirm: true` writes.
  Only the rows the rule change affects are rewritten; manual rows never are.

Safety: these tools can only change `category`, `subcategory`,
`categorySource` and `autoCategory` on transactions, and documents in
`categoryRules`. They cannot delete transactions or touch accounts or
`plaidItems`. Categories must already exist (older spellings are normalized)
unless `newCategory: true`, so typos don't create new ones. Every write adds a
document to `categoryAudit` with the values before and after. All category
writes, including `/categorize`, take one lock, so a sweep cannot overwrite a
manual edit made while it runs. The tools are marked destructive so Claude asks
before calling them; keep them on "ask" in the connector settings, since
transaction names are merchant-written text that ends up in chats.

When a pending transaction posts, Plaid gives it a new id. Sync copies a manual
category from the pending row to the posted one.

```bash
gcloud run services update dinero-mcp --region us-central1 --project dinero-3e826 \
  --update-env-vars DINERO_WRITE_TOOLS=on
```

## Encrypted Plaid tokens

Access tokens in `plaidItems` are encrypted with a Cloud KMS key
(`mcp/src/tokenCrypto.ts`). The key never leaves Google, so there is no key
file or secret to manage. Each ciphertext is bound to its item id. Stored
values look like `kms1:<base64>`; a value without that prefix is a legacy
plaintext token, which still works until it is migrated.

The service encrypts when `KMS_KEY_NAME` is set (the key, without a version).
Without it, plaintext tokens keep working and encrypted ones are reported as
`TOKEN_DECRYPT_FAILED` in the sync report.

One-time setup (KMS costs about $0.06 a month for one key version):

```bash
gcloud services enable cloudkms.googleapis.com --project dinero-3e826
gcloud kms keyrings create dinero --location us-central1 --project dinero-3e826
gcloud kms keys create plaid-tokens --keyring dinero --location us-central1 --project dinero-3e826 \
  --purpose encryption --rotation-period 365d --next-rotation-time $(date -u -v+365d +%Y-%m-%dT%H:%M:%SZ)
SA=$(gcloud run services describe dinero-mcp --region us-central1 --project dinero-3e826 --format 'value(spec.template.spec.serviceAccountName)')
gcloud kms keys add-iam-policy-binding plaid-tokens --keyring dinero --location us-central1 --project dinero-3e826 \
  --member "serviceAccount:$SA" --role roles/cloudkms.cryptoKeyEncrypterDecrypter
gcloud run services update dinero-mcp --region us-central1 --project dinero-3e826 \
  --update-env-vars KMS_KEY_NAME=projects/dinero-3e826/locations/us-central1/keyRings/dinero/cryptoKeys/plaid-tokens
```

Then encrypt the existing tokens. The dry run lists each bank's state without
any token material. Each new ciphertext is decrypted and compared before it
replaces the old value.

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' https://<service-url>/admin/encrypt-tokens
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"apply":true}' https://<service-url>/admin/encrypt-tokens
```

The old Next.js app reads tokens as plaintext, so its own Plaid sync stops
working for encrypted items. That is intended: `/sync` here replaces it.

Do not destroy or disable the key version while tokens use it; they become
unreadable and every bank would need re-linking. Rotation is safe: KMS keeps
old versions for decryption.

## Net worth history

Plaid only reports current balances, so each sync saves a snapshot of every
account's balance to `balanceSnapshots/{YYYY-MM-DD}` (Pacific date; a later
sync the same day replaces it). The daily job therefore builds one point per
day. `net_worth_history` reads them; history starts with the first snapshot.
A failed snapshot is logged and reported as `"snapshot": "failed"` but does not
fail the sync.
