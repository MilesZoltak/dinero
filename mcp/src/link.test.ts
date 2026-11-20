import assert from "node:assert/strict";
import { test } from "node:test";
import { finishLink, LinkError, startLink, type LinkPlaidLike, type LinkStore } from "./link.ts";

const saved: unknown[] = [];
const store = (items: Record<string, string> = {}, names: string[] = []): LinkStore => ({
  getPlaidItem: async (id) => (items[id] ? { accessToken: items[id] } : null),
  listInstitutionNames: async () => names,
  savePlaidItem: async (i) => void saved.push(i),
});
const plaidWith = (over: Partial<LinkPlaidLike> = {}) => {
  const created: Record<string, unknown>[] = [];
  const p: LinkPlaidLike = {
    linkTokenCreate: async (req) => (created.push(req), { data: { link_token: "link-1", expiration: "2026-11-20T18:00:00Z", hosted_link_url: "https://secure.plaid.com/hl/abc" } }),
    linkTokenGet: async () => ({ data: { link_sessions: [] } }),
    itemPublicTokenExchange: async () => ({ data: { access_token: "access-new", item_id: "item-new" } }),
    ...over,
  };
  return { p, created };
};

test("new bank: asks for transactions, investments optional, hosted link, no access token", async () => {
  const { p, created } = plaidWith();
  const r = await startLink(p, store(), {});
  assert.equal(r.mode, "new");
  assert.equal(r.hostedLinkUrl, "https://secure.plaid.com/hl/abc");
  assert.deepEqual(created[0].products, ["transactions"]);
  assert.deepEqual(created[0].optional_products, ["investments"]);
  assert.ok(created[0].hosted_link);
  assert.equal(created[0].access_token, undefined);
});

test("expired login: update mode uses the stored token and sends no products", async () => {
  const { p, created } = plaidWith();
  const r = await startLink(p, store({ i1: "access-1" }), { itemId: "i1" });
  assert.equal(r.mode, "update");
  assert.equal(created[0].access_token, "access-1");
  assert.equal(created[0].products, undefined);
  assert.equal(created[0].additional_consented_products, undefined);
});

test("add transactions: update mode plus additional consented products", async () => {
  const { p, created } = plaidWith();
  const r = await startLink(p, store({ i1: "access-1" }), { itemId: "i1", addTransactions: true });
  assert.equal(r.mode, "add_transactions");
  assert.deepEqual(created[0].additional_consented_products, ["transactions"]);
});

test("unknown or mock items are 404 and never reach Plaid", async () => {
  const { p, created } = plaidWith();
  await assert.rejects(startLink(p, store(), { itemId: "nope" }), (e: LinkError) => e.status === 404);
  await assert.rejects(startLink(p, store({ m: "mock_access_x" }), { itemId: "m" }), (e: LinkError) => e.status === 404);
  assert.equal(created.length, 0);
});

test("missing hosted link URL is a clear 502", async () => {
  const { p } = plaidWith({ linkTokenCreate: async () => ({ data: { link_token: "x" } }) });
  await assert.rejects(startLink(p, store(), {}), (e: LinkError) => e.status === 502 && /Hosted Link/.test(e.message));
});

test("finish exchanges and stores a new bank, flags duplicates, and returns no tokens", async () => {
  saved.length = 0;
  const { p } = plaidWith({
    linkTokenGet: async () => ({ data: { link_sessions: [{ finished_at: "t", results: { item_add_results: [{ public_token: "public-1", institution: { name: "Chase", institution_id: "ins_3" } }] } }] } }),
  });
  const r = await finishLink(p, store({}, ["Chase"]), "link-1");
  assert.equal(r.finished, true);
  assert.equal(r.added[0].itemId, "item-new");
  assert.match(r.added[0].warning ?? "", /already linked/);
  assert.deepEqual(saved, [{ itemId: "item-new", accessToken: "access-new", institutionId: "ins_3", institutionName: "Chase" }]);
  assert.ok(!JSON.stringify(r).includes("access-new"));
  assert.ok(!JSON.stringify(r).includes("public-1"));
});

test("finish on an update-mode or unfinished session adds nothing", async () => {
  saved.length = 0;
  const { p } = plaidWith({ linkTokenGet: async () => ({ data: { link_sessions: [{ finished_at: "t", results: { item_add_results: [] } }] } }) });
  const r = await finishLink(p, store(), "link-1");
  assert.deepEqual([r.finished, r.added.length, saved.length], [true, 0, 0]);
  const { p: p2 } = plaidWith();
  assert.equal((await finishLink(p2, store(), "link-1")).finished, false);
});

test("finish reports an exit error and an exchange failure without throwing", async () => {
  const { p } = plaidWith({
    linkTokenGet: async () => ({ data: { link_sessions: [{ exit: { error: { error_code: "INVALID_CREDENTIALS" } }, results: { item_add_results: [{ public_token: "p", institution: { name: "Bank" } }] } }] } }),
    itemPublicTokenExchange: async () => { throw Object.assign(new Error("x"), { response: { data: { error_code: "INVALID_PUBLIC_TOKEN" } } }); },
  });
  const r = await finishLink(p, store(), "link-1");
  assert.equal(r.exitedWithError, "INVALID_CREDENTIALS");
  assert.deepEqual(r.errors, ["Bank: INVALID_PUBLIC_TOKEN"]);
});

test("finish with an unknown link token is a 404", async () => {
  const { p } = plaidWith({ linkTokenGet: async () => { throw new Error("bad"); } });
  await assert.rejects(finishLink(p, store(), "x"), (e: LinkError) => e.status === 404);
});
