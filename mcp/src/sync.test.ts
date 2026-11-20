import assert from "node:assert/strict";
import { test } from "node:test";
import { localDate, syncAll, type AccountWrite, type ItemRecord, type PlaidLike, type PlaidTxLike, type SyncStore, type TxWrite } from "./sync.ts";

const tx = (id: string, over: Partial<PlaidTxLike> = {}): PlaidTxLike => ({
  transaction_id: id, account_id: "a1", amount: 10, date: "2026-11-01", name: "RAW NAME", ...over,
});

function memStore(items: ItemRecord[]) {
  const s = {
    items, accounts: new Map<string, AccountWrite>(), txs: new Map<string, TxWrite>(),
    cursors: new Map<string, string>(), deleted: [] as string[],
    async getPlaidItems() { return s.items; },
    async upsertAccounts(a: AccountWrite[]) { a.forEach((x) => s.accounts.set(x.id, x)); },
    async upsertTransactions(t: TxWrite[]) { t.forEach((x) => s.txs.set(x.id, { ...s.txs.get(x.id), ...x })); },
    async deleteTransactions(ids: string[]) { s.deleted.push(...ids); },
    async saveCursor(id: string, c: string) { s.cursors.set(id, c); },
    snapshots: [] as string[],
    failSnapshot: false,
    async snapshotBalances(date: string) { if (s.failSnapshot) throw new Error("boom"); s.snapshots.push(date); },
    async getCategoryRules() { return []; },
    async existingCategorizedIds(ids: string[]) { return new Set(ids.filter((i) => s.txs.get(i)?.category)); },
    async manualCategories(ids: string[]) {
      const m = new Map<string, { category: string; subcategory: string | null }>();
      for (const i of ids) { const t = s.txs.get(i); if (t?.categorySource === "manual" && t.category) m.set(i, { category: t.category, subcategory: t.subcategory ?? null }); }
      return m;
    },
  };
  return s satisfies SyncStore & Record<string, unknown>;
}

const item = (id: string, over: Partial<ItemRecord> = {}): ItemRecord => ({ itemId: id, accessToken: `access-${id}`, institutionName: `Bank ${id}`, ...over });
const acct = { account_id: "a1", name: "Checking", mask: "1234", type: "depository", subtype: "checking", balances: { current: 99.5, limit: null } };
const plaidErr = (code: string) => Object.assign(new Error(code), { response: { data: { error_code: code } } });

test("pages through history, writes accounts, transactions and cursor", async () => {
  const calls: (string | undefined)[] = [];
  const plaid: PlaidLike = {
    accountsGet: async () => ({ data: { accounts: [acct] } }),
    transactionsSync: async ({ cursor }) => {
      calls.push(cursor);
      return cursor === undefined
        ? { data: { added: [tx("t1")], modified: [], removed: [], next_cursor: "c1", has_more: true } }
        : { data: { added: [tx("t2", { merchant_name: "Nice Name", pending: true })], modified: [], removed: [{ transaction_id: "gone" }], next_cursor: "c2", has_more: false } };
    },
  };
  const store = memStore([item("i1")]);
  const report = await syncAll(plaid, store, "2026-11-20T00:00:00Z");
  assert.deepEqual(calls, [undefined, "c1"]);
  assert.equal(report.ok, true);
  assert.deepEqual(report.items[0], { itemId: "i1", institution: "Bank i1", status: "ok", accounts: 1, added: 2, modified: 0, removed: 1 });
  assert.equal(store.accounts.get("a1")?.balance, 99.5);
  assert.equal(store.accounts.get("a1")?.lastSync, "2026-11-20T00:00:00Z");
  assert.equal(store.txs.get("t2")?.name, "Nice Name");
  assert.equal(store.txs.get("t2")?.isPending, true);
  assert.deepEqual(store.deleted, ["gone"]);
  assert.equal(store.cursors.get("i1"), "c2");
});

test("resumes from the stored cursor", async () => {
  let seen: string | undefined;
  const plaid: PlaidLike = {
    accountsGet: async () => ({ data: { accounts: [] } }),
    transactionsSync: async ({ cursor }) => { seen = cursor; return { data: { added: [], modified: [], removed: [], next_cursor: "c9", has_more: false } }; },
  };
  await syncAll(plaid, memStore([item("i1", { syncCursor: "c5" })]));
  assert.equal(seen, "c5");
});

test("modified transactions keep the user's category; new ones get Plaid's", async () => {
  const plaid: PlaidLike = {
    accountsGet: async () => ({ data: { accounts: [] } }),
    transactionsSync: async () => ({ data: {
      added: [tx("new", { personal_finance_category: { primary: "FOOD_AND_DRINK" } })],
      modified: [tx("old", { amount: 12, personal_finance_category: { primary: "FOOD_AND_DRINK" } })],
      removed: [], next_cursor: "c", has_more: false } }),
  };
  const store = memStore([item("i1")]);
  store.txs.set("old", { id: "old", accountId: "a1", amount: 10, date: "2026-11-01", name: "x", isPending: false, isManual: false, plaidCategory: null, category: "My Custom" });
  await syncAll(plaid, store);
  assert.equal(store.txs.get("new")?.category, "Food & Drink");
  assert.equal(store.txs.get("new")?.categorySource, "plaid");
  assert.equal(store.txs.get("old")?.plaidCategory, "FOOD_AND_DRINK");
  assert.equal(store.txs.get("old")?.category, "My Custom");
  assert.equal(store.txs.get("old")?.amount, 12);
});

test("a failing item is reported and does not stop others or advance its cursor", async () => {
  const plaid: PlaidLike = {
    accountsGet: async ({ access_token }) => {
      if (access_token === "access-bad") throw plaidErr("ITEM_LOGIN_REQUIRED");
      if (access_token === "access-boom") throw plaidErr("INTERNAL_SERVER_ERROR");
      return { data: { accounts: [acct] } };
    },
    transactionsSync: async () => ({ data: { added: [tx("t1")], modified: [], removed: [], next_cursor: "c1", has_more: false } }),
  };
  const store = memStore([item("bad"), item("boom"), item("good")]);
  const r = await syncAll(plaid, store);
  assert.equal(r.ok, false);
  assert.deepEqual(r.items.map((i) => [i.itemId, i.status, i.error]), [
    ["bad", "login_required", "ITEM_LOGIN_REQUIRED"],
    ["boom", "error", "INTERNAL_SERVER_ERROR"],
    ["good", "ok", undefined],
  ]);
  assert.deepEqual([...store.cursors.keys()], ["good"]);
});

test("a failure while writing leaves the cursor unchanged", async () => {
  const plaid: PlaidLike = {
    accountsGet: async () => ({ data: { accounts: [] } }),
    transactionsSync: async () => ({ data: { added: [tx("t1")], modified: [], removed: [], next_cursor: "c1", has_more: false } }),
  };
  const store = memStore([item("i1")]);
  store.upsertTransactions = async () => { throw new Error("firestore down"); };
  const r = await syncAll(plaid, store);
  assert.equal(r.items[0].status, "error");
  assert.equal(store.cursors.size, 0);
});

test("restarts when data changes mid-pagination", async () => {
  let n = 0;
  const plaid: PlaidLike = {
    accountsGet: async () => ({ data: { accounts: [] } }),
    transactionsSync: async () => {
      if (n++ === 0) throw plaidErr("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION");
      return { data: { added: [tx("t1")], modified: [], removed: [], next_cursor: "c1", has_more: false } };
    },
  };
  const r = await syncAll(plaid, memStore([item("i1")]));
  assert.equal(r.items[0].status, "ok");
  assert.equal(r.items[0].added, 1);
});

test("mock items are skipped and never sent to Plaid", async () => {
  let called = false;
  const plaid: PlaidLike = {
    accountsGet: async () => { called = true; return { data: { accounts: [] } }; },
    transactionsSync: async () => { called = true; throw new Error("no"); },
  };
  const r = await syncAll(plaid, memStore([item("m", { accessToken: "mock_access_token_abc" })]));
  assert.equal(r.items[0].status, "skipped_mock");
  assert.equal(r.ok, true);
  assert.equal(called, false);
});

test("replaying history (added) does not overwrite categories we already hold", async () => {
  const plaid: PlaidLike = {
    accountsGet: async () => ({ data: { accounts: [] } }),
    transactionsSync: async () => ({ data: {
      added: [tx("have", { personal_finance_category: { primary: "GENERAL" } }), tx("fresh", { personal_finance_category: { primary: "GENERAL" } })],
      modified: [], removed: [], next_cursor: "c", has_more: false } }),
  };
  const store = memStore([item("i1")]);
  store.txs.set("have", { id: "have", accountId: "a1", amount: 10, date: "2026-08-01", name: "x", isPending: false, isManual: false, plaidCategory: null, category: "Food & Drink" });
  await syncAll(plaid, store);
  assert.equal(store.txs.get("have")?.category, "Food & Drink");
  assert.equal(store.txs.get("fresh")?.category, "General");
  assert.equal(store.txs.get("have")?.plaidCategory, "GENERAL");
});

test("no transactions consent is reported as balances_only, with balances still saved", async () => {
  const plaid: PlaidLike = {
    accountsGet: async () => ({ data: { accounts: [acct] } }),
    transactionsSync: async () => { throw plaidErr("ADDITIONAL_CONSENT_REQUIRED"); },
  };
  const store = memStore([item("inv")]);
  const r = await syncAll(plaid, store);
  assert.equal(r.items[0].status, "balances_only");
  assert.equal(r.items[0].accounts, 1);
  assert.equal(r.ok, true);
  assert.equal(store.accounts.get("a1")?.balance, 99.5);
  assert.equal(store.cursors.size, 0);
});

test("consent error before any account is read stays an error", async () => {
  const plaid: PlaidLike = {
    accountsGet: async () => { throw plaidErr("ADDITIONAL_CONSENT_REQUIRED"); },
    transactionsSync: async () => { throw new Error("unreachable"); },
  };
  const r = await syncAll(plaid, memStore([item("i1")]));
  assert.equal(r.items[0].status, "error");
});

test("a posted transaction inherits the manual category of the pending one it replaces", async () => {
  const plaid: PlaidLike = {
    accountsGet: async () => ({ data: { accounts: [acct] } }),
    transactionsSync: async () => ({
      data: {
        added: [tx("posted", { pending_transaction_id: "pend", personal_finance_category: { primary: "FOOD_AND_DRINK" } }), tx("other", { pending_transaction_id: "auto", personal_finance_category: { primary: "TRAVEL" } })],
        modified: [], removed: [{ transaction_id: "pend" }, { transaction_id: "auto" }], next_cursor: "c", has_more: false,
      },
    }),
  };
  const store = memStore([item("i1")]);
  store.txs.set("pend", { ...({} as TxWrite), id: "pend", category: "Shopping", subcategory: "Gifts", categorySource: "manual" });
  store.txs.set("auto", { ...({} as TxWrite), id: "auto", category: "Other", subcategory: null, categorySource: "plaid" });
  await syncAll(plaid, store);
  const posted = store.txs.get("posted")!;
  assert.deepEqual([posted.category, posted.subcategory, posted.categorySource, posted.plaidCategory], ["Shopping", "Gifts", "manual", "FOOD_AND_DRINK"]);
  assert.equal(store.txs.get("other")?.categorySource, "plaid", "non-manual pending rows are categorized normally");
  assert.deepEqual(store.deleted, ["pend", "auto"]);
});

test("resetCursors replays from the start and backfills plaidCategory without changing categories", async () => {
  let seen: string | undefined = "unset";
  const plaid: PlaidLike = {
    accountsGet: async () => ({ data: { accounts: [] } }),
    transactionsSync: async ({ cursor }) => {
      seen = cursor;
      return { data: { added: [tx("old", { personal_finance_category: { primary: "MEDICAL" } })], modified: [], removed: [], next_cursor: "c2", has_more: false } };
    },
  };
  const store = memStore([item("i1", { syncCursor: "c5" })]);
  store.txs.set("old", { ...({} as TxWrite), id: "old", category: "Utilities & Bills", plaidCategory: null, categorySource: "rule" });
  await syncAll(plaid, store, undefined, { resetCursors: true });
  assert.equal(seen, undefined);
  const old = store.txs.get("old")!;
  assert.equal(old.plaidCategory, "MEDICAL");
  assert.equal(old.category, "Utilities & Bills");
  assert.equal(old.categorySource, "rule");
  assert.equal(store.cursors.get("i1"), "c2");
});

test("an item whose token cannot be decrypted is reported and does not stop others", async () => {
  const seen: string[] = [];
  const plaid: PlaidLike = {
    accountsGet: async ({ access_token }) => (seen.push(access_token), { data: { accounts: [] } }),
    transactionsSync: async () => ({ data: { added: [], modified: [], removed: [], next_cursor: "c", has_more: false } }),
  };
  const report = await syncAll(plaid, memStore([item("bad", { accessToken: "", tokenError: "TOKEN_DECRYPT_FAILED" }), item("good")]));
  assert.deepEqual(report.items.map((i) => [i.itemId, i.status, i.error]), [["bad", "error", "TOKEN_DECRYPT_FAILED"], ["good", "ok", undefined]]);
  assert.deepEqual(seen, ["access-good"]);
  assert.equal(report.ok, false);
});

test("each sync saves a balance snapshot under the Pacific date; a failed snapshot does not fail the sync", async () => {
  const plaid: PlaidLike = {
    accountsGet: async () => ({ data: { accounts: [] } }),
    transactionsSync: async () => ({ data: { added: [], modified: [], removed: [], next_cursor: "c", has_more: false } }),
  };
  const store = memStore([item("i1")]);
  // 03:00 UTC on the 21st is still the 20th in Seattle.
  const r = await syncAll(plaid, store, "2026-11-21T03:00:00Z");
  assert.deepEqual([r.ok, r.snapshot, store.snapshots], [true, "2026-11-20", ["2026-11-20"]]);
  assert.equal(localDate("2026-11-21T14:00:00Z"), "2026-11-21");
  store.failSnapshot = true;
  const r2 = await syncAll(plaid, store, "2026-11-21T14:00:00Z");
  assert.deepEqual([r2.ok, r2.snapshot], [true, "failed"]);
});
