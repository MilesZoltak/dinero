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
  /** Only set for new transactions, so user recategorization survives later syncs. */
  category?: string;
}

export interface SyncStore {
  getPlaidItems(): Promise<ItemRecord[]>;
  upsertAccounts(accounts: AccountWrite[]): Promise<void>;
  upsertTransactions(txs: TxWrite[]): Promise<void>;
  deleteTransactions(ids: string[]): Promise<void>;
  saveCursor(itemId: string, cursor: string): Promise<void>;
}

export type ItemStatus = "ok" | "login_required" | "error" | "skipped_mock";

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
}

const MAX_PAGES = 200;

export function errorCode(err: unknown): string {
  const e = err as { response?: { data?: { error_code?: string } }; message?: string };
  return e?.response?.data?.error_code ?? e?.message ?? "UNKNOWN";
}

const LOGIN_CODES = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION"]);

function toTx(t: PlaidTxLike, withCategory: boolean): TxWrite {
  const w: TxWrite = {
    id: t.transaction_id,
    accountId: t.account_id,
    amount: t.amount,
    date: t.date,
    name: t.merchant_name || t.name,
    isPending: t.pending === true,
    isManual: false,
  };
  if (withCategory) {
    w.category = t.personal_finance_category?.primary || t.category?.[0] || "Uncategorized";
  }
  return w;
}

async function syncItem(plaid: PlaidLike, store: SyncStore, item: ItemRecord, now: string): Promise<ItemReport> {
  const report: ItemReport = {
    itemId: item.itemId,
    institution: item.institutionName,
    status: "ok",
    accounts: 0,
    added: 0,
    modified: 0,
    removed: 0,
  };
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
      let cursor = item.syncCursor;
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

      await store.upsertTransactions([...added.map((t) => toTx(t, true)), ...modified.map((t) => toTx(t, false))]);
      if (removed.length) await store.deleteTransactions(removed);
      if (cursor) await store.saveCursor(item.itemId, cursor);
      report.added = added.length;
      report.modified = modified.length;
      report.removed = removed.length;
      return report;
    }
  } catch (err) {
    const code = errorCode(err);
    report.status = LOGIN_CODES.has(code) ? "login_required" : "error";
    report.error = code;
    return report;
  }
}

/** Syncs every item. One item failing never stops the others. */
export async function syncAll(plaid: PlaidLike, store: SyncStore, now = new Date().toISOString()): Promise<SyncReport> {
  const items = await store.getPlaidItems();
  const reports: ItemReport[] = [];
  for (const item of items) reports.push(await syncItem(plaid, store, item, now));
  return { ok: reports.every((r) => r.status === "ok" || r.status === "skipped_mock"), items: reports };
}
