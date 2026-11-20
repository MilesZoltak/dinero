import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { canonicalCategory, categorize, pickRule, STANDARD_CATEGORIES, type CategoryRule, type CategorySource } from "./categorize.ts";
import { withCategoryLock, type CategorizeRow, type CategoryUpdate } from "./recategorize.ts";

/**
 * Write tools for Claude: recategorize one transaction, add or delete a rule.
 *
 * Safety: they can only change category, subcategory and categorySource on
 * transactions and documents in categoryRules. Rule changes preview unless
 * confirm is true. Every write is recorded in categoryAudit. Registered only
 * when DINERO_WRITE_TOOLS=on.
 */

export interface TxCategoryRow extends CategorizeRow {
  isPending: boolean;
  /** The automatic category a manual edit replaced, so it can be restored. */
  autoCategory: string | null;
}

export interface AuditEntry {
  at: string;
  tool: string;
  target: string;
  before: unknown;
  after: unknown;
  rows?: { id: string; from: string; to: string }[];
  rowCount?: number;
}

/** The only writes these tools can make. Nothing here can touch accounts, plaidItems or delete a transaction. */
export interface CategoryWriteStore {
  getRules(): Promise<CategoryRule[]>;
  getRows(): Promise<CategorizeRow[]>;
  getTransaction(id: string): Promise<TxCategoryRow | null>;
  setTransactionCategory(
    id: string,
    v: { category: string; subcategory: string | null; categorySource: CategorySource; autoCategory: string | null },
  ): Promise<void>;
  updateCategories(updates: CategoryUpdate[]): Promise<void>;
  /** Creates the rule; fails if a rule with this id already exists. */
  createRule(rule: CategoryRule): Promise<void>;
  deleteRule(id: string): Promise<void>;
  addAudit(entry: AuditEntry): Promise<void>;
}

export class CategoryInputError extends Error {}

const AUDIT_ROW_CAP = 2000;
const SAMPLE = 15;

const subcategorySchema = z.string().trim().min(1).max(40);

/** Every category name in use, plus the standard ones. */
function knownCategories(rows: CategorizeRow[], rules: CategoryRule[]): Set<string> {
  const s = new Set<string>(STANDARD_CATEGORIES);
  for (const r of rows) if (r.category) s.add(canonicalCategory(r.category));
  for (const r of rules) s.add(canonicalCategory(r.category));
  return s;
}

function suggestions(wanted: string, known: Set<string>): string[] {
  const w = wanted.toLowerCase();
  const scored = [...known].map((k) => {
    const kl = k.toLowerCase();
    const score = kl.includes(w) || w.includes(kl) ? 0 : kl.slice(0, 3) === w.slice(0, 3) ? 1 : kl[0] === w[0] ? 2 : 9;
    return { k, score };
  });
  return scored.filter((x) => x.score < 9).sort((a, b) => a.score - b.score).slice(0, 5).map((x) => x.k);
}

/** Normalizes the category and rejects unknown ones unless newCategory is set, so typos don't create categories. */
function resolveCategory(raw: string, known: Set<string>, newCategory: boolean): string {
  const c = canonicalCategory(raw.trim());
  if (!raw.trim() || c.length > 40) throw new CategoryInputError("Category must be 1 to 40 characters.");
  if (known.has(c) || newCategory) return c;
  const s = suggestions(c, known);
  throw new CategoryInputError(
    `"${c}" is not an existing category.${s.length ? ` Did you mean: ${s.join(", ")}?` : ""} Pass newCategory: true to create it.`,
  );
}

export function normalizePattern(raw: string): string {
  const p = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (p.length < 3 || p.length > 60) throw new CategoryInputError("Pattern must be 3 to 60 characters.");
  return p;
}

const ruleId = (pattern: string) =>
  `rule_${pattern.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x"}_${Date.now().toString(36)}`;

export interface RuleChangePreview {
  confirmed: boolean;
  rule: { id: string; pattern: string; category: string; subcategory: string | null };
  /** Transactions whose name contains the pattern. */
  matchingRows: number;
  /** Transactions whose category or subcategory this change would change. Manual rows are never changed. */
  changed: number;
  skippedManual: number;
  /** Rows that keep the deleted rule's category because Plaid's own category is not stored for them. */
  keptForLackOfPlaidCategory?: number;
  sample: { name: string; from: string; to: string }[];
  note?: string;
}

/**
 * The rows a rule change affects: categorized with the old rules versus the new
 * ones. Only differences caused by this change are written, so unrelated drift
 * is never applied as a side effect.
 */
function diffRules(rows: CategorizeRow[], before: CategoryRule[], after: CategoryRule[]) {
  const updates: (CategoryUpdate & { from: string })[] = [];
  let skippedManual = 0;
  for (const r of rows) {
    const input = { name: r.name, plaidCategory: r.plaidCategory, currentCategory: r.category };
    const a = categorize(input, before);
    const b = categorize(input, after);
    if (a.category === b.category && a.subcategory === b.subcategory && a.source === b.source) continue;
    if (r.categorySource === "manual") {
      skippedManual++;
      continue;
    }
    if (b.category !== r.category || b.subcategory !== r.subcategory || b.source !== r.categorySource) {
      updates.push({ id: r.id, from: r.category, category: b.category, subcategory: b.subcategory, categorySource: b.source });
    }
  }
  return { updates, skippedManual };
}

async function applyRuleChange(
  store: CategoryWriteStore,
  tool: string,
  rule: CategoryRule,
  rows: CategorizeRow[],
  before: CategoryRule[],
  after: CategoryRule[],
  confirm: boolean,
  write: () => Promise<void>,
): Promise<RuleChangePreview> {
  const { updates, skippedManual } = diffRules(rows, before, after);
  const pattern = rule.pattern.toLowerCase();
  const preview: RuleChangePreview = {
    confirmed: false,
    rule: { id: rule.id, pattern: rule.pattern, category: rule.category, subcategory: rule.subcategory ?? null },
    matchingRows: rows.filter((r) => r.name.toLowerCase().includes(pattern)).length,
    changed: updates.length,
    skippedManual,
    sample: updates.filter((u) => u.from !== u.category).slice(0, SAMPLE).map((u) => ({ name: rows.find((r) => r.id === u.id)!.name, from: u.from, to: u.category })),
  };
  if (!confirm) {
    preview.note = "Preview only, nothing was changed. Call again with confirm: true to apply.";
    return preview;
  }
  await write();
  if (updates.length) await store.updateCategories(updates.map(({ from: _from, ...u }) => u));
  await store.addAudit({
    at: new Date().toISOString(),
    tool,
    target: rule.id,
    before: tool === "delete_category_rule" ? preview.rule : null,
    after: tool === "add_category_rule" ? preview.rule : null,
    rowCount: updates.length,
    ...(updates.length <= AUDIT_ROW_CAP ? { rows: updates.map((u) => ({ id: u.id, from: u.from, to: u.category })) } : {}),
  });
  return { ...preview, confirmed: true };
}

export async function addCategoryRule(
  store: CategoryWriteStore,
  input: { pattern: string; category: string; subcategory?: string | null; newCategory?: boolean; confirm?: boolean },
): Promise<RuleChangePreview> {
  return withCategoryLock(async () => {
    const pattern = normalizePattern(input.pattern);
    const [rules, rows] = await Promise.all([store.getRules(), store.getRows()]);
    const dup = rules.find((r) => r.pattern.trim().toLowerCase() === pattern);
    if (dup) throw new CategoryInputError(`A rule for "${pattern}" already exists (${dup.id}, ${dup.category}). Delete it first to change it.`);
    const category = resolveCategory(input.category, knownCategories(rows, rules), input.newCategory === true);
    const subcategory = input.subcategory ? subcategorySchema.parse(input.subcategory) : null;
    const rule: CategoryRule = { id: ruleId(pattern), pattern, category, subcategory };
    return applyRuleChange(store, "add_category_rule", rule, rows, rules, [...rules, rule], input.confirm === true, () => store.createRule(rule));
  });
}

export async function deleteCategoryRule(store: CategoryWriteStore, input: { ruleId: string; confirm?: boolean }): Promise<RuleChangePreview> {
  return withCategoryLock(async () => {
    const [rules, rows] = await Promise.all([store.getRules(), store.getRows()]);
    const rule = rules.find((r) => r.id === input.ruleId);
    if (!rule) throw new CategoryInputError(`No rule with id "${input.ruleId}". Use list_category_rules to find it.`);
    const after = rules.filter((r) => r.id !== rule.id);
    const res = await applyRuleChange(store, "delete_category_rule", rule, rows, rules, after, input.confirm === true, () => store.deleteRule(rule.id));
    const kept = rows.filter((r) => r.categorySource !== "manual" && !r.plaidCategory && pickRule(r.name, rules)?.id === rule.id && !pickRule(r.name, after)).length;
    if (kept) {
      res.keptForLackOfPlaidCategory = kept;
      res.note = `${res.note ? res.note + " " : ""}${kept} rows keep this rule's category because Plaid's own category is not stored for them; they need the plaidCategory backfill or a manual change.`;
    }
    return res;
  });
}

export interface SetCategoryResult {
  id: string;
  name: string;
  before: { category: string; subcategory: string | null; categorySource: string | null };
  after: { category: string; subcategory: string | null; categorySource: string };
  warning?: string;
}

export async function setTransactionCategory(
  store: CategoryWriteStore,
  input: { transactionId: string; category: string | null; subcategory?: string | null; newCategory?: boolean },
): Promise<SetCategoryResult> {
  return withCategoryLock(async () => {
    const tx = await store.getTransaction(input.transactionId);
    if (!tx) throw new CategoryInputError(`No transaction with id "${input.transactionId}". Use query_transactions to find it.`);
    const before = { category: tx.category, subcategory: tx.subcategory, categorySource: tx.categorySource };
    const rules = await store.getRules();
    let after: SetCategoryResult["after"];
    let autoCategory: string | null;

    if (input.category === null) {
      // Back to automatic: recompute from the rules, Plaid's category, or the category the manual edit replaced.
      const c = categorize(
        { name: tx.name, plaidCategory: tx.plaidCategory, currentCategory: tx.categorySource === "manual" ? tx.autoCategory : tx.category },
        rules,
      );
      after = { category: c.category, subcategory: c.subcategory, categorySource: c.source };
      autoCategory = null;
    } else {
      const rows = await store.getRows();
      const category = resolveCategory(input.category, knownCategories(rows, rules), input.newCategory === true);
      const subcategory = input.subcategory ? subcategorySchema.parse(input.subcategory) : null;
      after = { category, subcategory, categorySource: "manual" };
      autoCategory = tx.categorySource === "manual" ? tx.autoCategory : tx.category || null;
    }

    await store.setTransactionCategory(tx.id, { ...after, categorySource: after.categorySource as CategorySource, autoCategory });
    await store.addAudit({ at: new Date().toISOString(), tool: "set_transaction_category", target: tx.id, before, after });
    const result: SetCategoryResult = { id: tx.id, name: tx.name, before, after };
    if (tx.isPending && input.category !== null) {
      result.warning = "This transaction is still pending. The category carries over when it posts, as long as Plaid links the posted transaction to this one.";
    }
    return result;
  });
}

export async function listCategoryRules(store: CategoryWriteStore) {
  const [rules, rows] = await Promise.all([store.getRules(), store.getRows()]);
  const wins = new Map<string, number>();
  for (const r of rows) {
    const rule = pickRule(r.name, rules);
    if (rule) wins.set(rule.id, (wins.get(rule.id) ?? 0) + 1);
  }
  return rules
    .map((r) => ({ id: r.id, pattern: r.pattern, category: canonicalCategory(r.category), subcategory: r.subcategory ?? null, matchingRows: wins.get(r.id) ?? 0 }))
    .sort((a, b) => a.pattern.localeCompare(b.pattern));
}

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const errorResult = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
const write = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

async function run(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (err) {
    if (err instanceof CategoryInputError || err instanceof z.ZodError) return errorResult(err.message);
    if (err instanceof Error && err.name === "CategoryBusyError") return errorResult(err.message);
    console.error("category write failed", err);
    return errorResult("The change failed. Nothing was reported as applied.");
  }
}

export function registerWriteTools(server: McpServer, store: CategoryWriteStore) {
  server.registerTool(
    "list_category_rules",
    {
      description:
        "Every category rule: id, pattern, category, subcategory, and how many transactions it currently wins. A rule matches when the transaction name contains the pattern (case-insensitive); the longest matching pattern wins.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => run(() => listCategoryRules(store)),
  );

  server.registerTool(
    "set_transaction_category",
    {
      description:
        "Recategorize one transaction by hand. The row is marked manual so rule sweeps never change it. Pass category null to undo a manual change and return the row to automatic categorization. Use an existing category name; pass newCategory true only when the user wants a new category.",
      inputSchema: {
        transactionId: z.string().min(1).max(200).describe("Transaction id, from query_transactions."),
        category: z.string().max(40).nullable().describe("Category name, or null to return to automatic."),
        subcategory: z.string().max(40).nullable().optional().describe("Optional subcategory."),
        newCategory: z.boolean().optional().describe("Allow a category name that is not in use yet. Default false."),
      },
      annotations: { ...write, idempotentHint: true },
    },
    async (a) => run(() => setTransactionCategory(store, a)),
  );

  server.registerTool(
    "add_category_rule",
    {
      description:
        "Add a rule: transactions whose name contains the pattern get this category. Without confirm: true this only previews which transactions would change; show the preview to the user and apply only after they agree. Manual rows are never changed.",
      inputSchema: {
        pattern: z.string().max(60).describe("Text the transaction name contains, 3 to 60 characters, case-insensitive."),
        category: z.string().max(40).describe("Existing category name."),
        subcategory: z.string().max(40).nullable().optional().describe("Optional subcategory."),
        newCategory: z.boolean().optional().describe("Allow a category name that is not in use yet. Default false."),
        confirm: z.boolean().optional().describe("Apply the change. Default false, which only previews."),
      },
      annotations: write,
    },
    async (a) => run(() => addCategoryRule(store, a)),
  );

  server.registerTool(
    "delete_category_rule",
    {
      description:
        "Delete a rule by id (from list_category_rules). Without confirm: true this only previews which transactions would change; show the preview to the user and apply only after they agree.",
      inputSchema: {
        ruleId: z.string().min(1).max(200).describe("Rule id from list_category_rules."),
        confirm: z.boolean().optional().describe("Apply the change. Default false, which only previews."),
      },
      annotations: write,
    },
    async (a) => run(() => deleteCategoryRule(store, a)),
  );
}
