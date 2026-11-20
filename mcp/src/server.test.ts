import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./server.ts";
import { toAccount, toTransaction, type Store } from "./store.ts";

const accounts = [
  toAccount("a1", { name: "Checking", type: "depository", subtype: "checking", balance: 1000.5, institutionName: "Bank", accessToken: "SECRET-TOKEN", itemId: "item1" }),
  toAccount("a2", { name: "Card", type: "credit", subtype: "credit card", balance: 200, institutionName: "Bank" }),
];
const txs = [
  toTransaction("t5", { accountId: "a1", amount: 500, date: "2026-11-03", name: "Card payment", category: "TRANSFER_OUT" }),
  toTransaction("t1", { accountId: "a1", amount: 50, date: "2026-10-03", name: "Trader Joes", category: "Groceries" }),
  toTransaction("t2", { accountId: "a1", amount: 25.25, date: "2026-10-15", name: "Uber", category: "Travel" }),
  toTransaction("t3", { accountId: "a1", amount: -3000, date: "2026-11-01", name: "Payroll", category: "Income" }),
  toTransaction("t4", { accountId: "a2", amount: 10, date: "2026-11-02", name: "Trader Joes", category: "Groceries" }),
];
const snaps = [
  { date: "2026-11-21", totalAssets: 1100, totalLiabilities: 200, netWorth: 900, accounts: [{ id: "a1", name: "Checking", institutionName: "Bank", type: "depository", balance: 1100 }] },
  { date: "2026-11-20", totalAssets: 1000, totalLiabilities: 200, netWorth: 800, accounts: [{ id: "a1", name: "Checking", institutionName: "Bank", type: "depository", balance: 1000 }] },
];
const fakeStore: Store = {
  getAccounts: async () => accounts,
  getBalanceSnapshots: async ({ startDate, endDate }) => snaps.filter((s) => (!startDate || s.date >= startDate) && (!endDate || s.date <= endDate)),
  getTransactions: async ({ startDate, endDate }) =>
    txs.filter((t) => (!startDate || t.date >= startDate) && (!endDate || t.date <= endDate)),
};

const TOKEN = "t".repeat(40);
let server: Server;
let base: string;

before(async () => {
  server = createApp(TOKEN, fakeStore).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const rpc = (body: unknown, token?: string) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const init = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
};

test("rejects missing and wrong tokens", async () => {
  assert.equal((await rpc(init)).status, 401);
  assert.equal((await rpc(init, "x".repeat(40))).status, 401);
});

test("lists and calls ping with the right token", async () => {
  assert.equal((await rpc(init, TOKEN)).status, 200);
  const list = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, TOKEN)).json();
  assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), [
    "ping", "get_accounts_summary", "query_transactions", "spend_by_category", "monthly_trend", "net_worth_history",
  ]);
  const call = await (
    await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ping", arguments: {} } }, TOKEN)
  ).json();
  assert.equal(JSON.parse(call.result.content[0].text).reply, "pong");
});

const tool = async (name: string, args: object = {}) => {
  const res = await (
    await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }, TOKEN)
  ).json();
  assert.ok(!res.result.isError, JSON.stringify(res));
  return JSON.parse(res.result.content[0].text);
};

test("accounts summary computes net worth and never exposes tokens", async () => {
  const r = await tool("get_accounts_summary");
  assert.equal(r.totalAssets, 1000.5);
  assert.equal(r.totalLiabilities, 200);
  assert.equal(r.netWorth, 800.5);
  assert.ok(!JSON.stringify(r).includes("SECRET-TOKEN"));
  assert.ok(!JSON.stringify(r).includes("item1"));
});

test("spend_by_category counts all expenses in range and skips income", async () => {
  const all = await tool("spend_by_category");
  assert.deepEqual(all, [
    { category: "Groceries", totalAmount: 60, transactionCount: 2 },
    { category: "Travel", totalAmount: 25.25, transactionCount: 1 },
  ]);
  const withTransfers = await tool("spend_by_category", { includeTransfers: true });
  assert.equal(withTransfers[0].category, "TRANSFER_OUT");
  const oct = await tool("spend_by_category", { startDate: "2026-10-01", endDate: "2026-10-31" });
  assert.equal(oct[0].totalAmount, 50);
});

test("query_transactions filters, sorts newest first and reports total matches", async () => {
  const r = await tool("query_transactions", { merchant: "trader", limit: 1 });
  assert.equal(r.totalMatches, 2);
  assert.equal(r.transactions.length, 1);
  assert.equal(r.transactions[0].id, "t4");
});

test("monthly_trend groups by month", async () => {
  const r = await tool("monthly_trend");
  assert.deepEqual(r, [
    { month: "2026-10", spend: 75.25, income: 0, net: -75.25 },
    { month: "2026-11", spend: 10, income: 3000, net: 2990 },
  ]);
  const incl = await tool("monthly_trend", { includeTransfers: true });
  assert.equal(incl.find((m: { month: string }) => m.month === "2026-11").spend, 510);
});

test("bad date input is rejected", async () => {
  const res = await (
    await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "spend_by_category", arguments: { startDate: "yesterday" } } }, TOKEN)
  ).json();
  assert.ok(res.result?.isError || res.error);
});

test("rejects short tokens at startup", () => {
  assert.throws(() => createApp("short", fakeStore));
});

async function withApp<T>(runSync: Parameters<typeof createApp>[2], fn: (url: string) => Promise<T>) {
  const s = createApp(TOKEN, fakeStore, runSync).listen(0);
  await new Promise((r) => s.once("listening", r));
  try {
    return await fn(`http://127.0.0.1:${(s.address() as AddressInfo).port}`);
  } finally {
    s.close();
  }
}
const post = (url: string, token?: string) =>
  fetch(`${url}/sync`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });

test("/sync requires the bearer token", async () => {
  await withApp(async () => ({ ok: true, items: [] }), async (url) => {
    assert.equal((await post(url)).status, 401);
    assert.equal((await post(url, "x".repeat(40))).status, 401);
  });
});

test("/sync says 503 when Plaid is not configured, and never mocks", async () => {
  await withApp(undefined, async (url) => {
    const r = await post(url, TOKEN);
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /not configured/);
  });
});

test("/sync returns 200 on full success and 207 when an item failed", async () => {
  await withApp(async () => ({ ok: true, items: [] }), async (url) => assert.equal((await post(url, TOKEN)).status, 200));
  await withApp(
    async () => ({ ok: false, items: [{ itemId: "i", institution: "B", status: "login_required", accounts: 0, added: 0, modified: 0, removed: 0, error: "ITEM_LOGIN_REQUIRED" }] }),
    async (url) => {
      const r = await post(url, TOKEN);
      assert.equal(r.status, 207);
      assert.equal((await r.json()).items[0].status, "login_required");
    },
  );
});

test("/sync refuses overlapping runs", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await withApp(async () => { await gate; return { ok: true, items: [] }; }, async (url) => {
    const first = post(url, TOKEN);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await post(url, TOKEN)).status, 409);
    release();
    assert.equal((await first).status, 200);
  });
});

const postJson = (url: string, path: string, body: unknown, token?: string) =>
  fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

test("/link/* needs the token, says 503 without Plaid, and validates input", async () => {
  await withApp(undefined, async (url) => {
    assert.equal((await postJson(url, "/link/start", {})).status, 401);
    assert.equal((await postJson(url, "/link/start", {}, TOKEN)).status, 503);
  });
  const link = {
    start: async () => ({ mode: "new" as const, hostedLinkUrl: "https://x", linkToken: "l", expiration: null }),
    finish: async () => ({ finished: true, exitedWithError: null, added: [], errors: [] }),
  };
  const s = createApp(TOKEN, fakeStore, undefined, link).listen(0);
  await new Promise((r) => s.once("listening", r));
  try {
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    assert.equal((await postJson(url, "/link/start", {}, TOKEN)).status, 200);
    assert.equal((await postJson(url, "/link/start", { itemId: 5 }, TOKEN)).status, 400);
    assert.equal((await postJson(url, "/link/finish", {}, TOKEN)).status, 400);
    assert.equal((await postJson(url, "/link/finish", { linkToken: "l" }, TOKEN)).status, 200);
  } finally {
    s.close();
  }
});

test("the scheduler's identity can run /sync but nothing else", async () => {
  const SCHED = "scheduler-identity-token";
  const verify = async (t: string) => t === SCHED;
  const link = {
    start: async () => ({ mode: "new" as const, hostedLinkUrl: "https://x", linkToken: "l", expiration: null }),
    finish: async () => ({ finished: true, exitedWithError: null, added: [], errors: [] }),
  };
  const s = createApp(TOKEN, fakeStore, async () => ({ ok: true, items: [] }), link, { verifySchedulerToken: verify }).listen(0);
  await new Promise((r) => s.once("listening", r));
  try {
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    assert.equal((await post(url, SCHED)).status, 200);
    assert.equal((await post(url, TOKEN)).status, 200);
    assert.equal((await post(url, "nope")).status, 401);
    assert.equal((await postJson(url, "/link/start", {}, SCHED)).status, 401);
    assert.equal((await rpc(init, SCHED)).status, 401);
  } finally {
    s.close();
  }
});


test("/categorize is a dry run unless apply is true, and needs the bearer token", async () => {
  const calls: boolean[] = [];
  const report = { dryRun: true, total: 0, skippedManual: 0, changed: 0, seededRules: 0, bySource: {}, categoriesAfter: [], sample: [] };
  const s = createApp(TOKEN, fakeStore, undefined, undefined, {
    recategorize: async ({ dryRun }) => (calls.push(dryRun), { ...report, dryRun }),
  }).listen(0);
  await new Promise((r) => s.once("listening", r));
  try {
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    assert.equal((await postJson(url, "/categorize", {})).status, 401);
    assert.equal((await postJson(url, "/categorize", {}, TOKEN)).status, 200);
    assert.equal((await postJson(url, "/categorize", { apply: "yes" }, TOKEN)).status, 200);
    assert.equal((await postJson(url, "/categorize", { apply: true }, TOKEN)).status, 200);
    assert.deepEqual(calls, [true, true, false]);
  } finally {
    s.close();
  }
  await withApp(undefined, async (url) => assert.equal((await postJson(url, "/categorize", {}, TOKEN)).status, 503));
});

test("/sync resetCursors needs the bearer token, not the scheduler identity", async () => {
  const SCHED = "scheduler-identity-token";
  const calls: unknown[] = [];
  const s = createApp(TOKEN, fakeStore, async (o) => (calls.push(o), { ok: true, items: [] }), undefined, { verifySchedulerToken: async (t) => t === SCHED }).listen(0);
  await new Promise((r) => s.once("listening", r));
  try {
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    assert.equal((await postJson(url, "/sync", { resetCursors: true }, SCHED)).status, 403);
    assert.equal((await postJson(url, "/sync", { resetCursors: true }, TOKEN)).status, 200);
    assert.equal((await postJson(url, "/sync", {}, SCHED)).status, 200);
    assert.deepEqual(calls, [{ resetCursors: true }, undefined]);
  } finally {
    s.close();
  }
});

test("write tools are listed only when a write store is given, and are not marked read-only", async () => {
  const writeStore = {
    getRules: async () => [], getRows: async () => [], getTransaction: async () => null, setTransactionCategory: async () => {},
    updateCategories: async () => {}, createRule: async () => {}, deleteRule: async () => {}, addAudit: async () => {},
  };
  const s = createApp(TOKEN, fakeStore, undefined, undefined, { writeStore }).listen(0);
  await new Promise((r) => s.once("listening", r));
  try {
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    const call = (body: unknown) =>
      fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
    const list = await (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    const byName = Object.fromEntries(list.result.tools.map((t: { name: string; annotations?: Record<string, boolean> }) => [t.name, t.annotations]));
    for (const n of ["set_transaction_category", "add_category_rule", "delete_category_rule"]) {
      assert.equal(byName[n]?.readOnlyHint, false, n);
      assert.equal(byName[n]?.destructiveHint, true, n);
    }
    assert.equal(byName.list_category_rules?.readOnlyHint, true);
    const res = await (await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "set_transaction_category", arguments: { transactionId: "x", category: "Shopping" } } })).json();
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /No transaction/);
  } finally {
    s.close();
  }
});

test("/admin/encrypt-tokens needs the bearer token and is a dry run unless apply is true", async () => {
  const calls: boolean[] = [];
  const SCHED = "scheduler-identity-token";
  const s = createApp(TOKEN, fakeStore, undefined, undefined, {
    verifySchedulerToken: async (t) => t === SCHED,
    migrateTokens: async ({ dryRun }) => (calls.push(dryRun), { dryRun, items: [], encrypted: 0 }),
  }).listen(0);
  await new Promise((r) => s.once("listening", r));
  try {
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    assert.equal((await postJson(url, "/admin/encrypt-tokens", {})).status, 401);
    assert.equal((await postJson(url, "/admin/encrypt-tokens", {}, SCHED)).status, 401);
    assert.equal((await postJson(url, "/admin/encrypt-tokens", {}, TOKEN)).status, 200);
    assert.equal((await postJson(url, "/admin/encrypt-tokens", { apply: true }, TOKEN)).status, 200);
    assert.deepEqual(calls, [true, false]);
  } finally {
    s.close();
  }
});

test("net_worth_history returns days oldest first with the change, accounts on request", async () => {
  const call = async (args: unknown) =>
    JSON.parse((await (await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "net_worth_history", arguments: args } }, TOKEN)).json()).result.content[0].text);
  const all = await call({});
  assert.deepEqual(all.points.map((p: { date: string }) => p.date), ["2026-11-20", "2026-11-21"]);
  assert.equal(all.change, 100);
  assert.equal(all.points[0].accounts, undefined);
  assert.equal((await call({ includeAccounts: true })).points[1].accounts[0].balance, 1100);
  const none = await call({ startDate: "2025-01-01", endDate: "2025-12-31" });
  assert.deepEqual([none.points.length, none.change], [0, null]);
  assert.match(none.note, /No balance snapshots/);
});
