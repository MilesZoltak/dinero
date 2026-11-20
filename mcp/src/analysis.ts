import type { Account, Transaction } from "./store.ts";

const round2 = (n: number) => Math.round(n * 100) / 100;

export const MAX_ROWS = 100;

export interface TxQuery {
  category?: string;
  subcategory?: string;
  merchant?: string;
  accountId?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
}

export function summarizeAccounts(accounts: Account[]) {
  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const a of accounts) {
    if (a.type === "credit" || a.type === "loan") totalLiabilities += Math.abs(a.balance);
    else totalAssets += a.balance;
  }
  return {
    accounts,
    totalAssets: round2(totalAssets),
    totalLiabilities: round2(totalLiabilities),
    netWorth: round2(totalAssets - totalLiabilities),
  };
}

const has = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase());

export function filterTransactions(txs: Transaction[], q: TxQuery): Transaction[] {
  return txs.filter(
    (t) =>
      (q.category === undefined || has(t.category, q.category)) &&
      (q.subcategory === undefined || has(t.subcategory ?? "", q.subcategory)) &&
      (q.merchant === undefined || has(t.name, q.merchant)) &&
      (q.accountId === undefined || t.accountId === q.accountId) &&
      (q.minAmount === undefined || Math.abs(t.amount) >= q.minAmount) &&
      (q.maxAmount === undefined || Math.abs(t.amount) <= q.maxAmount),
  );
}

export function queryTransactions(txs: Transaction[], q: TxQuery) {
  const matched = filterTransactions(txs, q).sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? 1 : -1,
  );
  const limit = Math.min(q.limit ?? 50, MAX_ROWS);
  return { totalMatches: matched.length, returned: Math.min(limit, matched.length), transactions: matched.slice(0, limit) };
}

/** Expenses only (positive amounts), over every transaction in the range. */
export function spendByCategory(txs: Transaction[]) {
  const map = new Map<string, { total: number; count: number }>();
  for (const t of txs) {
    if (t.amount <= 0) continue;
    const e = map.get(t.category) ?? { total: 0, count: 0 };
    e.total += t.amount;
    e.count += 1;
    map.set(t.category, e);
  }
  return [...map.entries()]
    .map(([category, e]) => ({ category, totalAmount: round2(e.total), transactionCount: e.count }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

/** One row per calendar month: spend (positive amounts), income (negative, shown positive), net. */
export function monthlyTrend(txs: Transaction[]) {
  const map = new Map<string, { spend: number; income: number }>();
  for (const t of txs) {
    const month = t.date.slice(0, 7);
    if (month.length !== 7) continue;
    const e = map.get(month) ?? { spend: 0, income: 0 };
    if (t.amount > 0) e.spend += t.amount;
    else e.income += -t.amount;
    map.set(month, e);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, e]) => ({
      month,
      spend: round2(e.spend),
      income: round2(e.income),
      net: round2(e.income - e.spend),
    }));
}
