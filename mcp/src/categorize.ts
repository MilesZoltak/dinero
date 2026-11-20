/**
 * Category rules and heuristics, ported from the old app's src/lib/categorizer.ts.
 *
 * Differences from the old code, on purpose:
 * - A rule match is deterministic: the longest matching pattern wins (ties by id).
 *   The old code took the first match in Firestore's document order.
 * - Without a rule, the category comes from Plaid's own category, shown under a
 *   readable name, instead of being flattened to "Other". Plaid categories that
 *   have no standard equivalent (Medical, Entertainment ...) keep their own name.
 * - String checks that could never match (mixed case against an uppercased name)
 *   are fixed.
 */

export interface CategoryRule {
  id: string;
  pattern: string;
  category: string;
  /** When set, only the subcategory is overridden (the rule's category must also match). */
  subcategory?: string | null;
}

export type CategorySource = "rule" | "plaid" | "existing" | "default" | "manual";

export const STANDARD_CATEGORIES = [
  "Income & Payroll",
  "Housing & Rent",
  "Food & Drink",
  "Shopping",
  "Travel & Transport",
  "Utilities & Bills",
  "Investments",
  "Transfer",
  "Other",
] as const;

export const DEFAULT_RULE_SEEDS: ReadonlyArray<{ pattern: string; category: string }> = [
  { pattern: "payment thank you", category: "Transfer" },
  { pattern: "thank you", category: "Transfer" },
  { pattern: "returned payment", category: "Transfer" },
  { pattern: "contribution", category: "Transfer" },
  { pattern: "chase credit crd", category: "Transfer" },
  { pattern: "credit card payment", category: "Transfer" },
  { pattern: "credit crd", category: "Transfer" },
  { pattern: "rocket savings", category: "Transfer" },
  { pattern: "keep the change", category: "Transfer" },
  { pattern: "keepthechange", category: "Transfer" },
  { pattern: "transfer", category: "Transfer" },
  { pattern: "payroll", category: "Income & Payroll" },
  { pattern: "salary", category: "Income & Payroll" },
  { pattern: "direct deposit", category: "Income & Payroll" },
  { pattern: "rent payment", category: "Housing & Rent" },
  { pattern: "mortgage", category: "Housing & Rent" },
  { pattern: "starbucks", category: "Food & Drink" },
  { pattern: "whole foods", category: "Food & Drink" },
  { pattern: "trader joe", category: "Food & Drink" },
  { pattern: "safeway", category: "Food & Drink" },
  { pattern: "h mart", category: "Food & Drink" },
  { pattern: "cafe", category: "Food & Drink" },
  { pattern: "coffee", category: "Food & Drink" },
  { pattern: "restaurant", category: "Food & Drink" },
  { pattern: "teriyaki", category: "Food & Drink" },
  { pattern: "doordash", category: "Food & Drink" },
  { pattern: "uber", category: "Travel & Transport" },
  { pattern: "lyft", category: "Travel & Transport" },
  { pattern: "chevron", category: "Travel & Transport" },
  { pattern: "shell", category: "Travel & Transport" },
  { pattern: "orca", category: "Travel & Transport" },
  { pattern: "goodtogo", category: "Travel & Transport" },
  { pattern: "wsdot", category: "Travel & Transport" },
  { pattern: "amazon", category: "Shopping" },
  { pattern: "target", category: "Shopping" },
  { pattern: "netflix", category: "Utilities & Bills" },
  { pattern: "spotify", category: "Utilities & Bills" },
  { pattern: "comcast", category: "Utilities & Bills" },
  { pattern: "schwab", category: "Investments" },
  { pattern: "fidelity", category: "Investments" },
  { pattern: "vanguard", category: "Investments" },
  { pattern: "therapy", category: "Utilities & Bills" },
  { pattern: "venmo", category: "Other" },
];

const keyOf = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

const CANONICAL: Record<string, string> = {
  "income": "Income & Payroll",
  "income and payroll": "Income & Payroll",
  "transfer": "Transfer",
  "transfer in": "Transfer",
  "transfer out": "Transfer",
  "food and drink": "Food & Drink",
  "shopping": "Shopping",
  "general merchandise": "Shopping",
  "travel": "Travel & Transport",
  "transportation": "Travel & Transport",
  "travel and transport": "Travel & Transport",
  "rent and utilities": "Utilities & Bills",
  "utilities and bills": "Utilities & Bills",
  "home improvement": "Housing & Rent",
  "housing and rent": "Housing & Rent",
  "investments": "Investments",
  "other": "Other",
  "government and non profit": "Government & non-profit",
};

/** Maps a Plaid primary category, or any older spelling of a category, to one display name. */
export function canonicalCategory(raw: string): string {
  const key = keyOf(raw);
  if (!key) return "Other";
  return CANONICAL[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export const isTransferCategory = (category: string) => canonicalCategory(category) === "Transfer";

/** The longest matching pattern wins, so "chase credit crd" beats "credit crd". */
export function pickRule(name: string, rules: CategoryRule[]): CategoryRule | null {
  const n = name.toLowerCase();
  let best: CategoryRule | null = null;
  let bestLen = 0;
  for (const r of rules) {
    const p = r.pattern.trim().toLowerCase();
    if (!p || !n.includes(p)) continue;
    if (!best || p.length > bestLen || (p.length === bestLen && r.id < best.id)) {
      best = r;
      bestLen = p.length;
    }
  }
  return best;
}

/** An explicit subcategory rule for this name and category, if one exists. */
export function ruleSubcategory(name: string, category: string, rules: CategoryRule[]): string | null {
  const withSub = rules.filter((r) => r.subcategory && canonicalCategory(r.category) === category);
  return pickRule(name, withSub)?.subcategory ?? null;
}

const has = (upper: string, ...needles: string[]) => needles.some((n) => upper.includes(n));

/** Heuristic subcategory for the standard categories. Null when nothing fits. */
export function heuristicSubcategory(name: string, category: string): string | null {
  const u = name.toUpperCase();
  switch (category) {
    case "Food & Drink":
      if (has(u, "STARBUCKS", "CAFE", "COFFEE", "BAGEL", "EPICUREAN", "AN?CLAIR")) return "Cafe";
      if (has(u, "WHOLEFDS", "WHOLE FOOD", "TRADER JOE", "SAFEWAY", "H MART", "GROCERY", "QFC", "MARKET")) return "Grocery";
      if (has(u, "DOORDASH", "DELIVERY", "EATS", "GRUBHUB")) return "Delivery";
      return null;
    case "Shopping":
      if (has(u, "AMAZON", "TARGET", "WALMART", "RETAIL")) return "Retail";
      if (has(u, "STEAM", "PLAYSTATION", "NINTENDO", "GAME", "ELECTRONICS", "APPLE")) return "Electronics";
      if (has(u, "BOOK", "LIBRARY", "AUDIBLE")) return "Books & Media";
      if (has(u, "CLOTHING", "GAP", "ZARA", "NORDSTROM")) return "Clothing";
      return "Other Shop";
    case "Utilities & Bills":
      if (has(u, "NETFLIX", "SPOTIFY", "YOUTUBE", "SUBSCRIBE", "IPHONE", "APPLE.COM")) return "Subscriptions";
      if (has(u, "MOBILE", "VERIZON", "AT&T", "INTERNET", "COMCAST")) return "Phone & Internet";
      if (has(u, "FEE", "MAINTENANCE", "INTEREST")) return "Fees";
      return "Utilities";
    case "Travel & Transport":
      if (has(u, "UBER", "LYFT", "TAXI", "RIDESHARE")) return "Rideshare";
      if (has(u, "SHELL", "CHEVRON", "GAS", "FUEL", "EXXON")) return "Gas & Fuel";
      if (has(u, "FLIGHT", "AIRLINE", "DELTA", "UNITED", "TRAIN", "AMTRAK", "TRAVEL")) return "Transit & Flights";
      return "Other Travel";
    case "Housing & Rent":
      if (has(u, "RENT", "MORTGAGE")) return "Rent";
      if (has(u, "MAINTENANCE", "REPAIR", "HARDWARE")) return "Maintenance";
      return "Other Housing";
    case "Investments":
      if (has(u, "401K", "401(K)", "IRA", "RETIREMENT", "FIDELITY", "CONTRIBUTION")) return "Retirement";
      if (has(u, "SCHWAB", "BROKERAGE", "STOCK")) return "Brokerage";
      return "Other Invest";
    case "Income & Payroll":
      if (has(u, "PAYROLL", "SALARY", "AUGER", "DIRECT DEPOSIT")) return "Salary";
      if (has(u, "REIMBURSE", "EXPENSE")) return "Reimbursement";
      if (has(u, "GIFT", "BONUS")) return "Gifts & Bonus";
      return "Other Income";
    case "Transfer":
      if (has(u, "CHASE CREDIT", "CREDIT CRD", "EPAY", "EPAYMENT", "RETURNED PAYMENT")) return "Credit Card Payment";
      if (has(u, "SAVINGS", "ROCKET", "MARCUS", "SFCU")) return "Savings Transfer";
      return "Other Transfer";
    case "Other":
      return "Uncategorized";
    default:
      return null;
  }
}

export interface CategorizeInput {
  name: string;
  /** Plaid's personal_finance_category.primary, when we have it. */
  plaidCategory?: string | null;
  /** What the transaction is filed under today, for rows synced before plaidCategory was stored. */
  currentCategory?: string | null;
}

export interface CategorizeResult {
  category: string;
  subcategory: string | null;
  source: Exclude<CategorySource, "manual">;
}

export function categorize(input: CategorizeInput, rules: CategoryRule[]): CategorizeResult {
  const rule = pickRule(input.name, rules);
  let category: string;
  let source: CategorizeResult["source"];
  if (rule) {
    category = canonicalCategory(rule.category);
    source = "rule";
  } else if (input.plaidCategory) {
    category = canonicalCategory(input.plaidCategory);
    source = "plaid";
  } else if (input.currentCategory && keyOf(input.currentCategory) !== "uncategorized") {
    category = canonicalCategory(input.currentCategory);
    // Plaid's codes are ALL_CAPS; the old app's own names are mixed case.
    source = /^[A-Z][A-Z_]+$/.test(input.currentCategory) ? "plaid" : "existing";
  } else {
    category = "Other";
    source = "default";
  }
  const subcategory = ruleSubcategory(input.name, category, rules) ?? heuristicSubcategory(input.name, category);
  return { category, subcategory, source };
}
