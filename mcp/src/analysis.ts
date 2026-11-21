import type { Account, BalanceSnapshot, Transaction } from "./store.ts";

export const round2 = (n: number) => Math.round(n * 100) / 100;

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

/**
 * Net worth per day from the daily balance snapshots, oldest first. History
 * only exists from the first snapshot onward; Plaid has no past balances.
 */
export function netWorthHistory(snaps: BalanceSnapshot[], opts: { includeAccounts?: boolean } = {}) {
  const points = [...snaps]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((s) => ({
      date: s.date,
      totalAssets: s.totalAssets,
      totalLiabilities: s.totalLiabilities,
      netWorth: s.netWorth,
      ...(opts.includeAccounts ? { accounts: s.accounts } : {}),
    }));
  const first = points[0];
  const last = points[points.length - 1];
  return {
    points,
    change: first && last ? round2(last.netWorth - first.netWorth) : null,
    ...(points.length === 0 ? { note: "No balance snapshots in this range. Snapshots are saved by each daily sync, starting when this feature was deployed." } : {}),
  };
}

const CADENCES = [
  { cadence: "weekly", min: 6, max: 8, perYear: 52 },
  { cadence: "biweekly", min: 13, max: 16, perYear: 26 },
  { cadence: "monthly", min: 26, max: 35, perYear: 12 },
  { cadence: "quarterly", min: 84, max: 98, perYear: 4 },
  { cadence: "yearly", min: 350, max: 380, perYear: 1 },
] as const;

/** Grouping key for a payee: lowercase, without reference numbers and punctuation. */
export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/#?\d{3,}\S*/g, " ")
    .replace(/conf#?\s*\S+/g, " ")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DAY = 86_400_000;
export const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
export const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);

export interface RecurringCharge {
  merchant: string;
  category: string;
  cadence: (typeof CADENCES)[number]["cadence"];
  typicalAmount: number;
  /** True when the charge amount changes noticeably from one time to the next (utilities, metered services). */
  amountVaries: boolean;
  occurrences: number;
  firstDate: string;
  lastDate: string;
  nextExpected: string;
  /** Typical days between charges. */
  intervalDays: number;
  active: boolean;
  annualCost: number;
}

/**
 * Whether these dates are evenly spaced in one cadence. Skipped periods (a gap
 * of two or three periods) and up to 20% irregular gaps are tolerated, since
 * real bills move with weekends and paydays.
 */
export function fitCadence(dates: string[], minRegular = 0.8) {
  if (dates.length < 2) return null;
  const gaps = dates.slice(1).map((d, i) => days(dates[i], d));
  if (gaps.some((g) => g <= 0)) return null;
  for (const band of CADENCES) {
    const base = median(gaps.filter((g) => g >= band.min && g <= band.max));
    if (Number.isNaN(base)) continue;
    const tol = Math.max(2, Math.round(base * (band.cadence === "weekly" ? 0.3 : 0.25)));
    const fits = (g: number) => [1, 2, 3].some((k) => Math.abs(g - k * base) <= tol * k);
    const single = gaps.filter((g) => Math.abs(g - base) <= tol).length;
    const regular = gaps.filter(fits).length;
    if (single >= gaps.length / 2 && regular >= gaps.length * minRegular) return { band, typicalGap: Math.round(base) };
  }
  return null;
}

/** Monthly bills whose amount varies: the largest set charged within a few days of the same day of the month, one per month. */
function sameDayOfMonth(list: Transaction[]): Transaction[] {
  const dom = (t: Transaction) => Number(t.date.slice(8, 10));
  let best: Transaction[] = [];
  for (let anchor = 1; anchor <= 31; anchor++) {
    const near = list.filter((t) => Math.abs(dom(t) - anchor) <= 2);
    const perMonth = new Map<string, Transaction>();
    for (const t of near) if (!perMonth.has(t.date.slice(0, 7))) perMonth.set(t.date.slice(0, 7), t);
    const set = [...perMonth.values()];
    if (set.length > best.length) best = set;
  }
  return best;
}

/**
 * Finds charges that repeat on a regular schedule. Expenses only; the caller
 * leaves out transfers. Two patterns:
 * - steady price: charges within 25% of the payee's usual amount, evenly spaced
 *   (one-off price changes and skipped periods are tolerated);
 * - metered monthly bills: varying amounts on about the same day each month,
 *   at least 4 times.
 * Restaurants and shops you visit often but irregularly do not qualify. A
 * shop visited only on the same day every month, with varying amounts, is
 * indistinguishable from a metered bill and will be listed.
 */
export function recurringCharges(txs: Transaction[], today: string, opts: { includeInactive?: boolean } = {}) {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.amount <= 0 || t.isPending) continue;
    const k = merchantKey(t.name);
    if (k) groups.set(k, [...(groups.get(k) ?? []), t]);
  }

  const out: RecurringCharge[] = [];
  const add = (run: Transaction[], fit: NonNullable<ReturnType<typeof fitCadence>>) => {
    const amounts = run.map((t) => t.amount);
    const mid = median(amounts);
    const last = run[run.length - 1];
    const active = days(last.date, today) <= fit.typicalGap * 1.5 + 7;
    if (!active && !opts.includeInactive) return;
    const typical = round2(median(amounts.slice(-3)));
    out.push({
      merchant: last.name,
      category: last.category,
      cadence: fit.band.cadence,
      typicalAmount: typical,
      amountVaries: median(amounts.map((x) => Math.abs(x - mid))) / (mid || 1) > 0.05,
      occurrences: run.length,
      firstDate: run[0].date,
      lastDate: last.date,
      nextExpected: addDays(last.date, fit.typicalGap),
      intervalDays: fit.typicalGap,
      active,
      annualCost: round2(typical * fit.band.perYear),
    });
  };

  for (const all of groups.values()) {
    const list = [...all].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let found = false;

    // Steady price: clusters of near-identical amounts (within 5%), each tested for an even schedule.
    const byAmount = [...list].sort((a, b) => a.amount - b.amount);
    const clusters: Transaction[][] = [];
    for (const t of byAmount) {
      const c = clusters[clusters.length - 1];
      if (c && t.amount - c[0].amount <= Math.max(0.5, c[0].amount * 0.05)) c.push(t);
      else clusters.push([t]);
    }
    for (const c of clusters) {
      const oneADay = [...new Map(c.map((t) => [t.date, t])).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
      const fit = fitCadence(oneADay.map((t) => t.date));
      const minRuns = fit?.band.cadence === "yearly" ? 2 : fit?.band.cadence === "weekly" || fit?.band.cadence === "biweekly" ? 4 : 3;
      if (!fit || oneADay.length < minRuns) continue;
      // Subscriptions bill the exact same amount; a cluster of merely similar purchases is shopping.
      const counts = new Map<number, number>();
      for (const t of oneADay) counts.set(t.amount, (counts.get(t.amount) ?? 0) + 1);
      if (Math.max(...counts.values()) < oneADay.length * 0.75) continue;
      add(oneADay, fit);
      found = true;
    }
    if (found) continue;

    // Metered monthly bill: varying amounts on about the same day each month, making up most of this payee's charges.
    const run = sameDayOfMonth(list);
    if (run.length < 4 || run.length < list.length * 0.6) continue;
    const fit = fitCadence(run.map((t) => t.date));
    if (!fit || fit.band.cadence !== "monthly") continue;
    const m = median(run.map((t) => t.amount));
    if (median(run.map((t) => Math.abs(t.amount - m))) / (m || 1) > 0.5) continue;
    add(run, fit);
  }
  out.sort((a, b) => b.annualCost - a.annualCost);
  const activeOnes = out.filter((r) => r.active);
  return {
    charges: out,
    activeCount: activeOnes.length,
    estimatedMonthlyTotal: round2(activeOnes.reduce((s, r) => s + r.annualCost, 0) / 12),
  };
}
