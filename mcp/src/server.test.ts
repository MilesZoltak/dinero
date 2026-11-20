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
  toTransaction("t1", { accountId: "a1", amount: 50, date: "2026-10-03", name: "Trader Joes", category: "Groceries" }),
  toTransaction("t2", { accountId: "a1", amount: 25.25, date: "2026-10-15", name: "Uber", category: "Travel" }),
  toTransaction("t3", { accountId: "a1", amount: -3000, date: "2026-11-01", name: "Payroll", category: "Income" }),
  toTransaction("t4", { accountId: "a2", amount: 10, date: "2026-11-02", name: "Trader Joes", category: "Groceries" }),
];
const fakeStore: Store = {
  getAccounts: async () => accounts,
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
    "ping", "get_accounts_summary", "query_transactions", "spend_by_category", "monthly_trend",
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
