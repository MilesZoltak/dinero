import { categorize, DEFAULT_RULE_SEEDS, type CategoryRule, type CategorySource } from "./categorize.ts";

export interface CategorizeRow {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  plaidCategory: string | null;
  plaidDetailed?: string | null;
  categorySource: string | null;
}

export interface CategoryUpdate {
  id: string;
  category: string;
  subcategory: string | null;
  categorySource: CategorySource;
}

export interface CategoryStore {
  getRules(): Promise<CategoryRule[]>;
  addRules(rules: CategoryRule[]): Promise<void>;
  getRows(): Promise<CategorizeRow[]>;
  updateCategories(updates: CategoryUpdate[]): Promise<void>;
}

export interface RecategorizeReport {
  dryRun: boolean;
  total: number;
  skippedManual: number;
  changed: number;
  seededRules: number;
  bySource: Record<string, number>;
  categoriesAfter: { category: string; count: number }[];
  sample: { name: string; from: string; to: string }[];
}

/** Thrown when another category change is already running in this instance. */
export class CategoryBusyError extends Error {
  constructor() {
    super("Another category change is already running. Try again in a moment.");
  }
}

let busy = false;

/**
 * Serializes everything that reads and rewrites categories (/categorize, rule
 * changes, manual edits), so a sweep cannot write back over a manual edit made
 * while it ran. Per instance only, which is enough for one user.
 */
export async function withCategoryLock<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) throw new CategoryBusyError();
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Recomputes category and subcategory for every transaction from the rules.
 * Rows marked categorySource "manual" are never touched. Default rules are seeded
 * only when there are no rules at all, so a rule you deleted stays deleted.
 */
export async function recategorizeAll(store: CategoryStore, opts: { dryRun: boolean }): Promise<RecategorizeReport> {
  let rules = await store.getRules();
  let seeded = 0;
  if (rules.length === 0) {
    const seeds: CategoryRule[] = DEFAULT_RULE_SEEDS.map((s) => ({ id: `seed_${slug(s.pattern)}`, pattern: s.pattern, category: s.category }));
    if (!opts.dryRun) await store.addRules(seeds);
    rules = seeds;
    seeded = seeds.length;
  }

  const rows = await store.getRows();
  const updates: CategoryUpdate[] = [];
  const bySource: Record<string, number> = {};
  const after = new Map<string, number>();
  const sample: RecategorizeReport["sample"] = [];
  let skippedManual = 0;

  for (const r of rows) {
    if (r.categorySource === "manual") {
      skippedManual++;
      after.set(r.category, (after.get(r.category) ?? 0) + 1);
      continue;
    }
    const res = categorize({ name: r.name, plaidCategory: r.plaidCategory, plaidDetailed: r.plaidDetailed, currentCategory: r.category }, rules);
    bySource[res.source] = (bySource[res.source] ?? 0) + 1;
    after.set(res.category, (after.get(res.category) ?? 0) + 1);
    if (res.category !== r.category || res.subcategory !== r.subcategory || r.categorySource !== res.source) {
      updates.push({ id: r.id, category: res.category, subcategory: res.subcategory, categorySource: res.source });
      if (res.category !== r.category && sample.length < 15) sample.push({ name: r.name, from: r.category, to: res.category });
    }
  }

  if (!opts.dryRun && updates.length) await store.updateCategories(updates);

  return {
    dryRun: opts.dryRun,
    total: rows.length,
    skippedManual,
    changed: updates.length,
    seededRules: seeded,
    bySource,
    categoriesAfter: [...after.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    sample,
  };
}
