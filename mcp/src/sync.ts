import { categorize, type CategoryRule } from "./categorize.ts";

/**
 * Plaid -> Firestore sync. Real Plaid only: there is no mock path. Items whose
 * access token starts with "mock_" (left over from the old app) are skipped and
 * reported, never synced.
 *
 * Uses /transactions/sync, so each run is incremental from a stored cursor and
 * the first run pulls all history Plaid has for the item, with paging.
 */

export interface PlaidAccountLike {
  account_id: string;
  name: string;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances: { current?: number | null; limit?: number | null };
}

export interface PlaidTxLike {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  name: string;
  merchant_name?: string | null;
  pending?: boolean;
  /** On a posted transaction: the id of the pending transaction it replaces. */
  pending_transaction_id?: string | null;
  personal_finance_category?: { primary?: string } | null;
  category?: string[] | null;
}

export interface PlaidLike {
  accountsGet(req: { access_token: string }): Promise<{ data: { accounts: PlaidAccountLike[] } }>;
  transactionsSync(req: { access_token: string; cursor?: string; count?: number }): Promise<{
    data: {
      added: PlaidTxLike[];
      modified: PlaidTxLike[];
      removed: { transaction_id: string }[];
      next_cursor: string;
      has_more: boolean;
    };
  }>;
}

export interface ItemRecord {
  itemId: string;
  accessToken: string;
  institutionName: string;
  syncCursor?: string;
  /** Set when the stored token could not be decrypted; the item is reported, not synced. */
  tokenError?: string;
}

export interface AccountWrite {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string;
  balance: number;
  limit: number | null;
  institutionName: string;
  isManual: false;
  itemId: string;
  lastSync: string;
}

export interface TxWrite {
  id: string;
  accountId: string;
  amount: number;
  date: string;
  name: string;
  isPending: boolean;
  isManual: false;
  /** Plaid's own primary category, kept so categories can be recomputed later. */
  plaidCategory: string | null;
  /** Only set for new transactions, so recategorization survives later syncs. */
  category?: string;
  subcategory?: string | null;
  categorySource?: "rule" | "plaid" | "existing" | "default" | "manual";
}

export interface ManualCategory {
  category: string;
  subcategory: string | null;
}

export interface SyncStore {
  getPlaidItems(): Promise<ItemRecord[]>;
  upsertAccounts(accounts: AccountWrite[]): Promise<void>;
  upsertTransactions(txs: TxWrite[]): Promise<void>;
  deleteTransactions(ids: string[]): Promise<void>;
  saveCursor(itemId: string, cursor: string): Promise<void>;
  getCategoryRules(): Promise<CategoryRule[]>;
  /** Of these ids, the ones that already exist with a category. Their category must not be overwritten. */
  existingCategorizedIds(ids: string[]): Promise<Set<string>>;
  /** Of these ids, the ones set by hand (categorySource "manual"), with their category. */
  manualCategories(ids: string[]): Promise<Map<string, ManualCategory>>;
  /** Saves today's balances of every account (one document per day; a later run that day replaces it). */
  snapshotBalances(date: string, takenAt: string): Promise<void>;
}

export interface SyncOptions {
  /**
   * Ignore stored cursors and replay all history Plaid has. Existing rows keep
   * their category but get Plaid's category stored (plaidCategory), which is how
   * rows synced before that field existed are backfilled.
   */
  resetCursors?: boolean;
}

/**
 * balances_only: the bank is connected and balances were updated, but Plaid has
 * no consent to read transactions (typical for items linked as Investments only).
 */
export type ItemStatus = "ok" | "balances_only" | "login_required" | "error" | "skipped_mock";

export interface ItemReport {
  itemId: string;
  institution: string;
  status: ItemStatus;
  accounts: number;
  added: number;
  modified: number;
  removed: number;
  error?: string;
}

export interface SyncReport {
  ok: boolean;
  items: ItemReport[];
  /** The day whose balance snapshot was saved, or "failed". A failed snapshot does not fail the sync. */
  snapshot?: string;
}

/** Calendar date in Miles's time zone, so a 6am Pacific run files under the right day. */
export function localDate(iso: string, timeZone = "America/Los_Angeles"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

const MAX_PAGES = 200;

export function errorCode(err: unknown): string {
  const e = err as { response?: { data?: { error_code?: string } }; message?: string };
  return e?.response?.data?.error_code ?? e?.message ?? "UNKNOWN";
}

const LOGIN_CODES = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION"]);

function toTx(t: PlaidTxLike, withCategory: boolean, rules: CategoryRule[]): TxWrite {
  const w: TxWrite = {
    id: t.transaction_id,
    accountId: t.account_id,
    amount: t.amount,
    date: t.date,
    name: t.merchant_name || t.name,
    isPending: t.pending === true,
    isManual: false,
    plaidCategory: t.personal_finance_category?.primary || t.category?.[0] || null,
  };
  if (withCategory) {
    const c = categorize({ name: w.name, plaidCategory: w.plaidCategory }, rules);
    w.category = c.category;
    w.subcategory = c.subcategory;
    w.categorySource = c.source;
  }
  return w;
}

async function syncItem(plaid: PlaidLike, store: SyncStore, item: ItemRecord, now: string, rules: CategoryRule[], opts: SyncOptions): Promise<ItemReport> {
  const report: ItemReport = {
    itemId: item.itemId,
    institution: item.institutionName,
    status: "ok",
    accounts: 0,
    added: 0,
    modified: 0,
    removed: 0,
  };
  if (item.tokenError) {
    report.status = "error";
    report.error = item.tokenError;
    return report;
  }
  if (!item.accessToken || item.accessToken.startsWith("mock_")) {
    report.status = "skipped_mock";
    return report;
  }

  try {
    const { data } = await plaid.accountsGet({ access_token: item.accessToken });
    await store.upsertAccounts(
      data.accounts.map((a) => ({
        id: a.account_id,
        name: a.name,
        mask: a.mask ?? null,
        type: a.type,
        subtype: a.subtype ?? "",
        balance: a.balances.current ?? 0,
        limit: a.balances.limit ?? null,
        institutionName: item.institutionName,
        isManual: false as const,
        itemId: item.itemId,
        lastSync: now,
      })),
    );
    report.accounts = data.accounts.length;

    // Collect every page first, then write, then save the cursor. If anything
    // fails the cursor stays put and the next run repeats the same window.
    let attempts = 0;
    for (;;) {
      const added: PlaidTxLike[] = [];
      const modified: PlaidTxLike[] = [];
      const removed: string[] = [];
      let cursor = opts.resetCursors ? undefined : item.syncCursor;
      let restart = false;

      for (let page = 0; page < MAX_PAGES; page++) {
        let res;
        try {
          res = await plaid.transactionsSync({ access_token: item.accessToken, cursor, count: 500 });
        } catch (err) {
          if (errorCode(err) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && ++attempts < 3) {
            restart = true;
            break;
          }
          throw err;
        }
        added.push(...res.data.added);
        modified.push(...res.data.modified);
        removed.push(...res.data.removed.map((r) => r.transaction_id));
        cursor = res.data.next_cursor;
        if (!res.data.has_more) break;
        if (page === MAX_PAGES - 1) throw new Error("Too many pages in one sync");
      }
      if (restart) continue;

      // A transaction we already hold keeps its category (the first run replays all
      // history, including rows the app has already categorized).
      const keep = await store.existingCategorizedIds(added.map((t) => t.transaction_id));
      // A pending transaction that posts arrives as a new id. Carry a manual category over to it.
      const pendingIds = added.flatMap((t) => (t.pending_transaction_id && !keep.has(t.transaction_id) ? [t.pending_transaction_id] : []));
      const manual = pendingIds.length ? await store.manualCategories(pendingIds) : new Map<string, ManualCategory>();
      await store.upsertTransactions([
        ...added.map((t) => {
          const m = t.pending_transaction_id ? manual.get(t.pending_transaction_id) : undefined;
          if (m && !keep.has(t.transaction_id)) return { ...toTx(t, false, rules), category: m.category, subcategory: m.subcategory, categorySource: "manual" as const };
          return toTx(t, !keep.has(t.transaction_id), rules);
        }),
        ...modified.map((t) => toTx(t, false, rules)),
      ]);
      if (removed.length) await store.deleteTransactions(removed);
      if (cursor) await store.saveCursor(item.itemId, cursor);
      report.added = added.length;
      report.modified = modified.length;
      report.removed = removed.length;
      return report;
    }
  } catch (err) {
    const code = errorCode(err);
    if (code === "ADDITIONAL_CONSENT_REQUIRED" && report.accounts > 0) {
      report.status = "balances_only";
      report.error = code;
      return report;
    }
    report.status = LOGIN_CODES.has(code) ? "login_required" : "error";
    report.error = code;
    return report;
  }
}

/** Syncs every item. One item failing never stops the others. */
export async function syncAll(plaid: PlaidLike, store: SyncStore, now = new Date().toISOString(), opts: SyncOptions = {}): Promise<SyncReport> {
  const items = await store.getPlaidItems();
  const rules = await store.getCategoryRules();
  const reports: ItemReport[] = [];
  for (const item of items) reports.push(await syncItem(plaid, store, item, now, rules, opts));
  const ok = reports.every((r) => r.status === "ok" || r.status === "balances_only" || r.status === "skipped_mock");
  let snapshot: string;
  try {
    snapshot = localDate(now);
    await store.snapshotBalances(snapshot, now);
  } catch (err) {
    console.error("balance snapshot failed:", err instanceof Error ? err.message : "unknown error");
    snapshot = "failed";
  }
  return { ok, items: reports, snapshot };
}
