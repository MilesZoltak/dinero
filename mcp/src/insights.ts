import { addDays, days, fitCadence, median, merchantKey, recurringCharges, round2 } from "./analysis.ts";
import type { Account, Transaction } from "./store.ts";

/**
 * Spending insights in the spirit of a budgeting app's home screen: where the
 * money goes (subcategories, merchants), how this month compares, what is
 * coming up, what is safe to spend, and what deserves a look. All pure
 * functions over plain rows; the caller leaves out transfers.
 */

const expenses = (txs: Transaction[]) => txs.filter((t) => t.amount > 0);
const monthOf = (d: string) => d.slice(0, 7);
const sub = (t: Transaction) => t.subcategory ?? "Other";

/** Spend per category and subcategory, largest first. */
export function spendBreakdown(txs: Transaction[], opts: { category?: string } = {}) {
  const map = new Map<string, { category: string; subcategory: string; totalAmount: number; transactionCount: number }>();
  for (const t of expenses(txs)) {
    if (opts.category && t.category !== opts.category) continue;
    const k = `${t.category}\u0000${sub(t)}`;
    const e = map.get(k) ?? { category: t.category, subcategory: sub(t), totalAmount: 0, transactionCount: 0 };
    e.totalAmount += t.amount;
    e.transactionCount++;
    map.set(k, e);
  }
  return [...map.values()].map((e) => ({ ...e, totalAmount: round2(e.totalAmount) })).sort((a, b) => b.totalAmount - a.totalAmount);
}

/** Spend per month and category (or subcategory), oldest month first. */
export function categoryByMonth(txs: Transaction[], opts: { category?: string; bySubcategory?: boolean } = {}) {
  const map = new Map<string, { month: string; category: string; subcategory?: string; spend: number; count: number }>();
  for (const t of expenses(txs)) {
    if (opts.category && t.category !== opts.category) continue;
    const k = [monthOf(t.date), t.category, opts.bySubcategory ? sub(t) : ""].join("\u0000");
    const e = map.get(k) ?? { month: monthOf(t.date), category: t.category, ...(opts.bySubcategory ? { subcategory: sub(t) } : {}), spend: 0, count: 0 };
    e.spend += t.amount;
    e.count++;
    map.set(k, e);
  }
  return [...map.values()].map((e) => ({ ...e, spend: round2(e.spend) })).sort((a, b) => (a.month === b.month ? b.spend - a.spend : a.month < b.month ? -1 : 1));
}

/** Payees ranked by total spend. Names that differ only in reference numbers count as one. */
export function topMerchants(txs: Transaction[], opts: { category?: string; limit?: number } = {}) {
  const map = new Map<string, { merchant: string; category: string; totalAmount: number; transactionCount: number; lastDate: string }>();
  for (const t of expenses(txs)) {
    if (opts.category && t.category !== opts.category) continue;
    const k = merchantKey(t.name) || t.name;
    const e = map.get(k) ?? { merchant: t.name, category: t.category, totalAmount: 0, transactionCount: 0, lastDate: t.date };
    e.totalAmount += t.amount;
    e.transactionCount++;
    if (t.date >= e.lastDate) {
      e.lastDate = t.date;
      e.merchant = t.name;
      e.category = t.category;
    }
    map.set(k, e);
  }
  const total = [...map.values()].reduce((s, e) => s + e.totalAmount, 0);
  return [...map.values()]
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, opts.limit ?? 15)
    .map((e) => ({ ...e, totalAmount: round2(e.totalAmount), share: total ? round2(e.totalAmount / total) : 0 }));
}

const daysInMonth = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const shiftMonth = (ym: string, n: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/**
 * This month so far against the same days of last month and the average of
 * the three full months before this one, overall and per category. Needs
 * transactions from the start of three months ago through today.
 */
export function spendingThisMonth(txs: Transaction[], today: string) {
  const month = monthOf(today);
  const day = Number(today.slice(8, 10));
  const last = shiftMonth(month, -1);
  const lastCut = `${last}-${String(Math.min(day, daysInMonth(last))).padStart(2, "0")}`;
  const prior = [shiftMonth(month, -3), shiftMonth(month, -2), last];
  const firstDate = txs.reduce((m, t) => (t.date < m ? t.date : m), today);
  // Average only over months the history covers, so a short history isn't read as low spending:
  // a month with no data, or the first month of history when it starts after the 7th, is left out.
  const covered = prior.filter((m) => firstDate.slice(0, 7) < m || (firstDate.slice(0, 7) === m && Number(firstDate.slice(8, 10)) <= 7));

  type Row = { category: string; thisMonth: number; lastMonthToDate: number; lastMonth: number; avg3Months: number | null };
  const rows = new Map<string, Row>();
  const totals = { spendSoFar: 0, lastMonthToDate: 0, lastMonth: 0, priorSum: 0, incomeSoFar: 0 };
  for (const t of txs) {
    const m = monthOf(t.date);
    if (t.amount < 0) {
      if (m === month && t.date <= today) totals.incomeSoFar += -t.amount;
      continue;
    }
    const r = rows.get(t.category) ?? { category: t.category, thisMonth: 0, lastMonthToDate: 0, lastMonth: 0, avg3Months: 0 };
    if (m === month && t.date <= today) {
      r.thisMonth += t.amount;
      totals.spendSoFar += t.amount;
    }
    if (m === last) {
      r.lastMonth += t.amount;
      totals.lastMonth += t.amount;
      if (t.date <= lastCut) {
        r.lastMonthToDate += t.amount;
        totals.lastMonthToDate += t.amount;
      }
    }
    if (covered.includes(m)) {
      r.avg3Months! += t.amount;
      totals.priorSum += t.amount;
    }
    rows.set(t.category, r);
  }
  const avg = (x: number) => (covered.length ? round2(x / covered.length) : null);
  const categories = [...rows.values()]
    .map((r) => ({
      category: r.category,
      thisMonth: round2(r.thisMonth),
      lastMonthToDate: round2(r.lastMonthToDate),
      lastMonth: round2(r.lastMonth),
      avg3Months: avg(r.avg3Months ?? 0),
      changeVsLastMonthToDate: round2(r.thisMonth - r.lastMonthToDate),
    }))
    .filter((r) => r.thisMonth || r.lastMonth || r.avg3Months)
    .sort((a, b) => b.thisMonth - a.thisMonth || b.lastMonth - a.lastMonth);
  return {
    totals: {
      month,
      today,
      dayOfMonth: day,
      daysInMonth: daysInMonth(month),
      spendSoFar: round2(totals.spendSoFar),
      lastMonthToDate: round2(totals.lastMonthToDate),
      lastMonth: round2(totals.lastMonth),
      avg3Months: avg(totals.priorSum),
      monthsAveraged: covered.length,
      incomeSoFar: round2(totals.incomeSoFar),
      netSoFar: round2(totals.incomeSoFar - totals.spendSoFar),
    },
    categories,
  };
}

export interface RecurringIncome {
  payer: string;
  cadence: string;
  typicalAmount: number;
  lastDate: string;
  nextExpected: string;
  intervalDays: number;
  occurrences: number;
  active: boolean;
  annualAmount: number;
}

const PER_YEAR: Record<string, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, yearly: 1 };

/**
 * Income that arrives on a schedule, such as payroll. Unlike charges, a
 * paycheck's amount varies, and one paycheck can land as several deposits on
 * the same day, so same-day deposits are added together and amounts may vary
 * by up to a third.
 */
export function recurringIncome(txs: Transaction[], today: string): RecurringIncome[] {
  const groups = new Map<string, Map<string, Transaction>>();
  for (const t of txs) {
    if (t.amount >= 0 || t.isPending) continue;
    const k = merchantKey(t.name);
    if (!k) continue;
    const byDay = groups.get(k) ?? new Map<string, Transaction>();
    const cur = byDay.get(t.date);
    byDay.set(t.date, cur ? { ...cur, amount: cur.amount + t.amount } : t);
    groups.set(k, byDay);
  }
  const out: RecurringIncome[] = [];
  for (const byDay of groups.values()) {
    const run = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (run.length < 3) continue;
    // Paydays drift with holidays and schedule changes, so allow more irregular gaps than for bills.
    const fit = fitCadence(run.map((t) => t.date), 0.6);
    if (!fit) continue;
    const amounts = run.map((t) => -t.amount);
    const mid = median(amounts);
    if (median(amounts.map((a) => Math.abs(a - mid))) / (mid || 1) > 0.33) continue;
    const last = run[run.length - 1];
    const typical = round2(median(amounts.slice(-3)));
    out.push({
      payer: last.name,
      cadence: fit.band.cadence,
      typicalAmount: typical,
      lastDate: last.date,
      nextExpected: addDays(last.date, fit.typicalGap),
      intervalDays: fit.typicalGap,
      occurrences: run.length,
      active: days(last.date, today) <= fit.typicalGap * 1.5 + 7,
      annualAmount: round2(typical * PER_YEAR[fit.band.cadence]),
    });
  }
  return out.sort((a, b) => b.annualAmount - a.annualAmount);
}

/** The paycheck: the largest active income that comes at least monthly. */
function mainPaycheck(income: RecurringIncome[]) {
  return income.find((i) => i.active && ["weekly", "biweekly", "monthly"].includes(i.cadence) && i.typicalAmount >= 500) ?? null;
}

/** Each expected date of something recurring from `from` through `to`, projected from its last date. */
function projections(lastDate: string, interval: number, from: string, to: string) {
  const out: string[] = [];
  let d = addDays(lastDate, interval);
  // A charge that is a little late still shows, on today's date.
  while (d < from && days(d, from) > 3) d = addDays(d, interval);
  for (let i = 0; d <= to && i < 60; i++, d = addDays(d, interval)) out.push(d < from ? from : d);
  return out;
}

export interface UpcomingItem {
  date: string;
  kind: "bill" | "income";
  name: string;
  amount: number;
  cadence: string;
  category: string | null;
  amountVaries: boolean;
}

/** Recurring bills and income expected in the next `horizon` days, soonest first. */
export function upcoming(txs: Transaction[], today: string, horizon = 14): UpcomingItem[] {
  const to = addDays(today, horizon);
  const items: UpcomingItem[] = [];
  for (const c of recurringCharges(txs, today).charges) {
    for (const date of projections(c.lastDate, c.intervalDays, today, to)) {
      items.push({ date, kind: "bill", name: c.merchant, amount: c.typicalAmount, cadence: c.cadence, category: c.category, amountVaries: c.amountVaries });
    }
  }
  for (const i of recurringIncome(txs, today)) {
    if (!i.active) continue;
    for (const date of projections(i.lastDate, i.intervalDays, today, to)) {
      items.push({ date, kind: "income", name: i.payer, amount: i.typicalAmount, cadence: i.cadence, category: null, amountVaries: true });
    }
  }
  return items.sort((a, b) => (a.date === b.date ? b.amount - a.amount : a.date < b.date ? -1 : 1));
}

const isLiability = (a: Account) => a.type === "credit" || a.type === "loan";
const isChecking = (a: Account) => a.type === "depository" && !/savings|cd|money market|hsa/i.test(a.subtype);

/**
 * An estimate of what can be spent before the next paycheck: cash in checking,
 * minus what is owed on credit cards, minus recurring bills expected before
 * payday. Savings and investments are not counted as spendable.
 */
export function safeToSpend(accounts: Account[], txs: Transaction[], today: string) {
  const checking = round2(accounts.filter(isChecking).reduce((s, a) => s + a.balance, 0));
  const cards = round2(accounts.filter((a) => a.type === "credit").reduce((s, a) => s + Math.abs(a.balance), 0));
  const pay = mainPaycheck(recurringIncome(txs, today));
  const nextPay = pay ? projections(pay.lastDate, pay.intervalDays, today, addDays(today, 60))[0] ?? null : null;
  const until = nextPay ?? addDays(today, 14);
  const bills = upcoming(txs, today, Math.max(0, days(today, until))).filter((i) => i.kind === "bill" && i.date < until);
  const billTotal = round2(bills.reduce((s, b) => s + b.amount, 0));
  return {
    safeToSpend: round2(checking - cards - billTotal),
    checking,
    creditCardBalances: cards,
    billsBeforePayday: billTotal,
    nextPayday: nextPay,
    paycheck: pay ? { payer: pay.payer, typicalAmount: pay.typicalAmount, cadence: pay.cadence } : null,
    until,
    bills: bills.map((b) => ({ date: b.date, name: b.name, amount: b.amount })),
    note: pay ? "Estimate: checking, minus credit card balances, minus recurring bills due before the next paycheck." : "No regular paycheck found, so bills over the next 14 days are counted.",
    loans: round2(accounts.filter((a) => a.type === "loan").reduce((s, a) => s + Math.abs(a.balance), 0)),
    accountsCounted: accounts.filter((a) => isChecking(a) || isLiability(a)).length,
  };
}

export interface Flag {
  date: string;
  kind: "fee" | "price_increase" | "duplicate" | "large";
  merchant: string;
  amount: number;
  detail: string;
}

const FEE = /\b(fee|late charge|interest charge|overdraft|nsf|finance charge)\b/i;

/**
 * Things worth a look in the last `windowDays`: fees and interest charged,
 * subscription price increases, likely duplicate charges, and charges far
 * above what that payee usually costs. Needs about six months of history.
 */
export function worthALook(txs: Transaction[], today: string, windowDays = 45): Flag[] {
  const from = addDays(today, -windowDays);
  const flags: Flag[] = [];
  const byPayee = new Map<string, Transaction[]>();
  for (const t of expenses(txs)) {
    const k = merchantKey(t.name);
    if (k) byPayee.set(k, [...(byPayee.get(k) ?? []), t]);
  }

  for (const t of expenses(txs)) {
    if (t.date < from) continue;
    if (t.category === "Bank fees" || FEE.test(t.name)) {
      flags.push({ date: t.date, kind: "fee", merchant: t.name, amount: t.amount, detail: "A fee or interest charge." });
    }
  }

  for (const list of byPayee.values()) {
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // Price increase: at least three identical charges, then a higher one.
    for (let i = 3; i < sorted.length; i++) {
      const t = sorted[i];
      if (t.date < from) continue;
      const prev = sorted.slice(i - 3, i).map((x) => x.amount);
      if (prev.every((a) => a === prev[0]) && t.amount > prev[0] * 1.02 && t.amount < prev[0] * 1.6 && !sorted.slice(i + 1).some((x) => x.amount === prev[0])) {
        flags.push({ date: t.date, kind: "price_increase", merchant: t.name, amount: t.amount, detail: `Up from ${prev[0].toFixed(2)}, which it was the previous ${prev.length} times.` });
        break;
      }
    }
    // Duplicate: same payee, same amount, within a day.
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      if (b.date < from || b.amount !== a.amount || days(a.date, b.date) > 1 || b.amount < 5) continue;
      flags.push({ date: b.date, kind: "duplicate", merchant: b.name, amount: b.amount, detail: `Charged the same amount on ${a.date === b.date ? "the same day" : "consecutive days"}. Could be a double charge, or two real purchases.` });
    }
    // Unusually large for this payee.
    const before = sorted.filter((t) => t.date < from).map((t) => t.amount);
    for (const [i, t] of sorted.entries()) {
      if (t.date < from) continue;
      // The same amount paid here before (rent, a subscription) is expected, not unusual.
      if (sorted.slice(0, i).some((x) => Math.abs(x.amount - t.amount) <= t.amount * 0.01)) continue;
      if (before.length >= 3 && t.amount >= 100 && t.amount >= 3 * median(before)) {
        flags.push({ date: t.date, kind: "large", merchant: t.name, amount: t.amount, detail: `About ${Math.round(t.amount / median(before))}x the usual ${median(before).toFixed(2)} here.` });
      } else if (before.length === 0 && t.amount >= 500) {
        flags.push({ date: t.date, kind: "large", merchant: t.name, amount: t.amount, detail: "A large charge from a payee you haven't paid before." });
      }
    }
  }
  return flags.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.amount - a.amount)).map((f) => ({ ...f, amount: round2(f.amount) }));
}
