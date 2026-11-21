import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalCategory, categorize, DEFAULT_RULE_SEEDS, heuristicSubcategory, isTransferCategory, pickRule, type CategoryRule } from "./categorize.ts";
import { recategorizeAll, type CategorizeRow, type CategoryStore, type CategoryUpdate } from "./recategorize.ts";

const rule = (id: string, pattern: string, category: string, subcategory?: string): CategoryRule => ({ id, pattern, category, subcategory });

test("the longest matching pattern wins, regardless of list order", () => {
  const rules = [rule("a", "credit crd", "Transfer"), rule("b", "chase credit crd", "Utilities & Bills")];
  assert.equal(pickRule("CHASE CREDIT CRD EPAY", rules)?.id, "b");
  assert.equal(pickRule("CHASE CREDIT CRD EPAY", [...rules].reverse())?.id, "b");
  assert.equal(pickRule("nothing here", rules), null);
  assert.equal(pickRule("x", [rule("e", "  ", "Other")]), null);
});

test("canonicalCategory merges every spelling of the same thing", () => {
  for (const s of ["FOOD_AND_DRINK", "Food & Drink", "food and drink"]) assert.equal(canonicalCategory(s), "Food & Drink");
  for (const s of ["TRAVEL", "Travel", "TRANSPORTATION", "Travel & Transport"]) assert.equal(canonicalCategory(s), "Travel & Transport");
  for (const s of ["TRANSFER_OUT", "TRANSFER_IN", "Transfer"]) assert.equal(isTransferCategory(s), true);
  assert.equal(isTransferCategory("LOAN_PAYMENTS"), false);
  assert.equal(canonicalCategory("MEDICAL"), "Medical");
  assert.equal(canonicalCategory("GOVERNMENT_AND_NON_PROFIT"), "Government & non-profit");
  assert.equal(canonicalCategory(""), "Other");
});

test("rule beats Plaid, Plaid beats the old category, and the last resort is Other", () => {
  const rules = [rule("r", "starbucks", "Food & Drink")];
  assert.deepEqual(categorize({ name: "STARBUCKS 123", plaidCategory: "GENERAL_MERCHANDISE" }, rules), { category: "Food & Drink", subcategory: "Coffee", source: "rule" });
  assert.deepEqual(categorize({ name: "Clinic", plaidCategory: "MEDICAL" }, rules), { category: "Medical", subcategory: null, source: "plaid" });
  assert.equal(categorize({ name: "Mystery", currentCategory: "FOOD_AND_DRINK" }, rules).category, "Food & Drink");
  assert.equal(categorize({ name: "Mystery", currentCategory: "Travel" }, rules).source, "existing");
  assert.deepEqual(categorize({ name: "Mystery" }, rules), { category: "Other", subcategory: "Uncategorized", source: "default" });
  assert.equal(categorize({ name: "Mystery", currentCategory: "Uncategorized" }, rules).source, "default");
});

test("an explicit subcategory rule overrides the heuristic", () => {
  const rules = [rule("r1", "orca", "Travel & Transport"), rule("r2", "orca", "Travel & Transport", "Commute")];
  assert.equal(categorize({ name: "ORCA card" }, rules).subcategory, "Commute");
});

test("heuristics that could never match in the old code now do", () => {
  assert.equal(heuristicSubcategory("Returned Payment", "Transfer"), "Credit Card Payment");
  assert.equal(heuristicSubcategory("Marcus deposit", "Transfer"), "Savings Transfer");
  assert.equal(heuristicSubcategory("Uber trip", "Travel & Transport"), "Rideshare");
  assert.equal(heuristicSubcategory("Joes", "Food & Drink"), null);
  assert.equal(heuristicSubcategory("x", "Medical"), null);
});

test("every seed rule maps to a known category", () => {
  assert.ok(DEFAULT_RULE_SEEDS.length >= 40);
  for (const s of DEFAULT_RULE_SEEDS) assert.ok(s.pattern && s.category);
});

function memStore(rules: CategoryRule[], rows: CategorizeRow[]) {
  const s = {
    rules, rows, added: [] as CategoryRule[], updates: [] as CategoryUpdate[],
    getRules: async () => s.rules,
    addRules: async (r: CategoryRule[]) => void s.added.push(...r),
    getRows: async () => s.rows,
    updateCategories: async (u: CategoryUpdate[]) => void s.updates.push(...u),
  };
  return s satisfies CategoryStore & Record<string, unknown>;
}
const row = (id: string, name: string, category: string, over: Partial<CategorizeRow> = {}): CategorizeRow => ({
  id, name, category, subcategory: null, plaidCategory: null, categorySource: null, ...over,
});

test("a dry run reports changes and writes nothing, even seeds", async () => {
  const store = memStore([], [row("1", "Starbucks", "Other"), row("2", "Rent payment", "HOME_IMPROVEMENT")]);
  const r = await recategorizeAll(store, { dryRun: true });
  assert.equal(r.dryRun, true);
  assert.equal(r.changed, 2);
  assert.equal(r.seededRules, DEFAULT_RULE_SEEDS.length);
  assert.equal(store.updates.length + store.added.length, 0);
  assert.deepEqual(r.sample.map((s) => [s.name, s.from, s.to]), [["Starbucks", "Other", "Food & Drink"], ["Rent payment", "HOME_IMPROVEMENT", "Housing & Rent"]]);
});

test("applying writes updates, skips manual rows, and does not reseed existing rules", async () => {
  const store = memStore(
    [rule("r", "starbucks", "Food & Drink")],
    [row("1", "Starbucks", "Other"), row("2", "Starbucks", "Shopping", { categorySource: "manual" }), row("3", "Clinic", "MEDICAL")],
  );
  const r = await recategorizeAll(store, { dryRun: false });
  assert.equal(r.skippedManual, 1);
  assert.equal(r.seededRules, 0);
  assert.equal(store.added.length, 0);
  assert.deepEqual(store.updates.map((u) => [u.id, u.category, u.categorySource]), [["1", "Food & Drink", "rule"], ["3", "Medical", "plaid"]]);
  assert.deepEqual(r.categoriesAfter.map((c) => c.category).sort(), ["Food & Drink", "Medical", "Shopping"]);
});

test("a second run changes nothing", async () => {
  const store = memStore([rule("r", "starbucks", "Food & Drink")], [row("1", "Starbucks", "Food & Drink", { subcategory: "Coffee", categorySource: "rule" })]);
  assert.equal((await recategorizeAll(store, { dryRun: false })).changed, 0);
});

test("Plaid's detailed category becomes the subcategory, unless a rule moved the category", async () => {
  const { plaidSubcategory } = await import("./categorize.ts");
  assert.equal(plaidSubcategory("FOOD_AND_DRINK_COFFEE", "FOOD_AND_DRINK"), "Coffee");
  assert.equal(plaidSubcategory("FOOD_AND_DRINK_RESTAURANT", "FOOD_AND_DRINK"), "Restaurants");
  assert.equal(plaidSubcategory("FOOD_AND_DRINK_FAST_FOOD", "FOOD_AND_DRINK"), "Fast food");
  assert.equal(plaidSubcategory("FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK", "FOOD_AND_DRINK"), null);
  assert.equal(plaidSubcategory("TRANSPORTATION_TAXIS_AND_RIDE_SHARES", "TRANSPORTATION"), "Rideshare");
  assert.equal(plaidSubcategory("MEDICAL_PRIMARY_CARE", "FOOD_AND_DRINK"), null);
  const noRules: CategoryRule[] = [];
  assert.deepEqual(categorize({ name: "Ox Burger", plaidCategory: "FOOD_AND_DRINK", plaidDetailed: "FOOD_AND_DRINK_FAST_FOOD" }, noRules), { category: "Food & Drink", subcategory: "Fast food", source: "plaid" });
  // Plaid's catch-all falls back to the name heuristic.
  assert.equal(categorize({ name: "Safeway", plaidCategory: "FOOD_AND_DRINK", plaidDetailed: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK" }, noRules).subcategory, "Groceries");
  // Orca: Plaid says general services, a rule says transport, so Plaid's detail no longer applies.
  const moved = categorize({ name: "Orca", plaidCategory: "GENERAL_SERVICES", plaidDetailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES" }, [rule("o", "orca", "Travel & Transport")]);
  assert.equal(moved.category, "Travel & Transport");
  assert.notEqual(moved.subcategory, "Other general services");
  // An explicit subcategory rule still wins over Plaid.
  assert.equal(categorize({ name: "Cafe X", plaidCategory: "FOOD_AND_DRINK", plaidDetailed: "FOOD_AND_DRINK_RESTAURANT" }, [rule("c", "cafe x", "Food & Drink", "Brunch")]).subcategory, "Brunch");
});
