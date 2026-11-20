import assert from "node:assert/strict";
import { test } from "node:test";
import type { CategoryRule } from "./categorize.ts";
import {
  addCategoryRule,
  CategoryInputError,
  deleteCategoryRule,
  listCategoryRules,
  normalizePattern,
  setTransactionCategory,
  type AuditEntry,
  type CategoryWriteStore,
  type TxCategoryRow,
} from "./categoryWrites.ts";
import { recategorizeAll } from "./recategorize.ts";

const row = (id: string, name: string, category: string, over: Partial<TxCategoryRow> = {}): TxCategoryRow => ({
  id, name, category, subcategory: null, plaidCategory: null, categorySource: "plaid", isPending: false, autoCategory: null, ...over,
});

function memStore(rules: CategoryRule[], rows: TxCategoryRow[]) {
  const s = {
    rules: [...rules],
    rows: new Map(rows.map((r) => [r.id, { ...r }])),
    audit: [] as AuditEntry[],
    async getRules() { return s.rules.map((r) => ({ ...r })); },
    async getRows() { return [...s.rows.values()].map((r) => ({ ...r })); },
    async getTransaction(id: string) { const r = s.rows.get(id); return r ? { ...r } : null; },
    async setTransactionCategory(id: string, v: { category: string; subcategory: string | null; categorySource: string; autoCategory: string | null }) {
      Object.assign(s.rows.get(id)!, v);
    },
    async updateCategories(us: { id: string; category: string; subcategory: string | null; categorySource: string }[]) {
      for (const u of us) Object.assign(s.rows.get(u.id)!, u);
    },
    async createRule(r: CategoryRule) {
      if (s.rules.some((x) => x.id === r.id)) throw new Error("exists");
      s.rules.push(r);
    },
    async deleteRule(id: string) { s.rules = s.rules.filter((r) => r.id !== id); },
    async addAudit(e: AuditEntry) { s.audit.push(e); },
  };
  return s satisfies CategoryWriteStore;
}

const rules: CategoryRule[] = [
  { id: "r_cafe", pattern: "cafe", category: "Food & Drink" },
  { id: "r_therapy", pattern: "therapy", category: "Medical" },
];

test("add_category_rule previews without writing, then applies and audits on confirm", async () => {
  const store = memStore(rules, [
    row("t1", "Retail Therapy", "Medical", { categorySource: "rule" }),
    row("t2", "Spring Day Therapy", "Medical", { categorySource: "rule" }),
    row("t3", "Cafe Flora", "Food & Drink", { categorySource: "rule" }),
  ]);
  const preview = await addCategoryRule(store, { pattern: "  Retail   THERAPY ", category: "shopping" });
  assert.equal(preview.confirmed, false);
  assert.equal(preview.rule.pattern, "retail therapy");
  assert.equal(preview.rule.category, "Shopping");
  assert.equal(preview.matchingRows, 1);
  assert.equal(preview.changed, 1);
  assert.deepEqual(preview.sample, [{ name: "Retail Therapy", from: "Medical", to: "Shopping" }]);
  assert.equal(store.rules.length, 2);
  assert.equal(store.rows.get("t1")!.category, "Medical");
  assert.equal(store.audit.length, 0);

  const done = await addCategoryRule(store, { pattern: "retail therapy", category: "Shopping", confirm: true });
  assert.equal(done.confirmed, true);
  assert.equal(store.rules.length, 3);
  assert.equal(store.rows.get("t1")!.category, "Shopping");
  assert.equal(store.rows.get("t2")!.category, "Medical");
  assert.equal(store.audit.length, 1);
  assert.deepEqual(store.audit[0].rows, [{ id: "t1", from: "Medical", to: "Shopping" }]);
});

test("rule changes never touch manual rows and only write rows the change affects", async () => {
  const store = memStore(rules, [
    row("m", "Cafe Mozart", "Shopping", { categorySource: "manual" }),
    row("drift", "Some Shop", "GENERAL_MERCHANDISE"), // would be renamed by a full sweep, but this change does not affect it
    row("t", "Cafe Mozart Annex", "Food & Drink", { categorySource: "rule" }),
  ]);
  const res = await addCategoryRule(store, { pattern: "cafe mozart", category: "Entertainment", newCategory: true, confirm: true });
  assert.equal(res.changed, 1);
  assert.equal(res.skippedManual, 1);
  assert.equal(store.rows.get("m")!.category, "Shopping");
  assert.equal(store.rows.get("drift")!.category, "GENERAL_MERCHANDISE");
  assert.equal(store.rows.get("t")!.category, "Entertainment");
});

test("input checks: pattern length, duplicates, unknown categories with suggestions", async () => {
  const store = memStore(rules, [row("t", "x", "Food & Drink")]);
  assert.throws(() => normalizePattern("ab"), CategoryInputError);
  assert.throws(() => normalizePattern("x".repeat(61)), CategoryInputError);
  await assert.rejects(addCategoryRule(store, { pattern: "CAFE", category: "Food & Drink" }), /already exists/);
  await assert.rejects(addCategoryRule(store, { pattern: "bakery", category: "Fod" }), /not an existing category.*Food & Drink/);
  // Older spellings normalize to an existing category instead of failing.
  const ok = await addCategoryRule(store, { pattern: "bakery", category: "food and drink" });
  assert.equal(ok.rule.category, "Food & Drink");
  assert.equal(store.rules.length, 2, "preview did not write");
});

test("delete_category_rule previews, deletes on confirm, and reports rows that lack Plaid's category", async () => {
  const store = memStore(rules, [
    row("a", "Cafe Flora", "Food & Drink", { categorySource: "rule" }),
    row("b", "Cafe Hagen", "Food & Drink", { categorySource: "rule", plaidCategory: "ENTERTAINMENT" }),
  ]);
  const preview = await deleteCategoryRule(store, { ruleId: "r_cafe" });
  assert.equal(preview.confirmed, false);
  assert.equal(preview.changed, 2); // a's source moves to existing, b's category moves to Entertainment
  assert.equal(preview.keptForLackOfPlaidCategory, 1);
  assert.match(preview.note!, /backfill/);
  assert.equal(store.rules.length, 2);

  await deleteCategoryRule(store, { ruleId: "r_cafe", confirm: true });
  assert.deepEqual(store.rules.map((r) => r.id), ["r_therapy"]);
  assert.equal(store.rows.get("a")!.category, "Food & Drink");
  assert.equal(store.rows.get("a")!.categorySource, "existing");
  assert.equal(store.rows.get("b")!.category, "Entertainment");
  assert.equal(store.audit[0].tool, "delete_category_rule");
  await assert.rejects(deleteCategoryRule(store, { ruleId: "nope" }), /No rule/);
});

test("set_transaction_category marks manual, survives a sweep, and null returns it to automatic", async () => {
  const store = memStore(rules, [row("t1", "Retail Therapy", "Medical", { categorySource: "rule" })]);
  const res = await setTransactionCategory(store, { transactionId: "t1", category: "Shopping", subcategory: "Gifts" });
  assert.deepEqual(res.after, { category: "Shopping", subcategory: "Gifts", categorySource: "manual" });
  assert.equal(store.rows.get("t1")!.autoCategory, "Medical");
  assert.equal(store.audit[0].tool, "set_transaction_category");

  // A full sweep leaves it alone.
  const sweep = await recategorizeAll({ ...store, addRules: async () => {} }, { dryRun: false });
  assert.equal(sweep.skippedManual, 1);
  assert.equal(store.rows.get("t1")!.category, "Shopping");

  // Changing it again keeps the original automatic category for the undo.
  await setTransactionCategory(store, { transactionId: "t1", category: "Entertainment", newCategory: true });
  assert.equal(store.rows.get("t1")!.autoCategory, "Medical");

  const undo = await setTransactionCategory(store, { transactionId: "t1", category: null });
  assert.deepEqual(undo.after, { category: "Medical", subcategory: null, categorySource: "rule" });
  assert.equal(store.rows.get("t1")!.autoCategory, null);
});

test("set_transaction_category validates input and warns on pending rows", async () => {
  const store = memStore(rules, [row("p", "Cafe Flora", "Food & Drink", { isPending: true })]);
  await assert.rejects(setTransactionCategory(store, { transactionId: "missing", category: "Shopping" }), /No transaction/);
  await assert.rejects(setTransactionCategory(store, { transactionId: "p", category: "Shoping" }), /Did you mean: Shopping/);
  const res = await setTransactionCategory(store, { transactionId: "p", category: "Shopping" });
  assert.match(res.warning!, /pending/);
});

test("list_category_rules counts the rows each rule wins", async () => {
  const store = memStore(
    [...rules, { id: "r_spring", pattern: "spring day therapy", category: "Medical" }],
    [row("a", "Spring Day Therapy", "Medical"), row("b", "Retail Therapy", "Medical"), row("c", "Cafe X", "Food & Drink")],
  );
  const list = await listCategoryRules(store);
  assert.deepEqual(list.map((r) => [r.id, r.matchingRows]), [["r_cafe", 1], ["r_spring", 1], ["r_therapy", 1]]);
});
