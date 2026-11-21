import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryByMonth, recurringIncome, safeToSpend, spendBreakdown, spendingThisMonth, topMerchants, upcoming, worthALook } from "./insights.ts";
import { toAccount, type Transaction } from "./store.ts";

let n = 0;
const tx = (name: string, date: string, amount: number, category = "Shopping", subcategory: string | null = null): Transaction => ({
  id: String(n++), accountId: "a", amount, date, name, category, subcategory, isPending: false,
});
const addDays = (d: string, k: number) => new Date(Date.parse(d) + k * 86_400_000).toISOString().slice(0, 10);
const every = (name: string, start: string, step: number, count: number, amount: number, category = "Shopping") =>
  Array.from({ length: count }, (_, i) => tx(name, addDays(start, i * step), amount, category));
const TODAY = "2026-11-20";

test("spendBreakdown splits a category by subcategory and ignores income", () => {
  const rows = spendBreakdown([
    tx("PCC", "2026-11-01", 40, "Food & Drink", "Groceries"),
    tx("Safeway", "2026-11-02", 20, "Food & Drink", "Groceries"),
    tx("Cafe", "2026-11-02", 5, "Food & Drink", "Coffee"),
    tx("Mystery", "2026-11-02", 7, "Food & Drink"),
    tx("Pay", "2026-11-02", -1000, "Income & Payroll"),
  ]);
  assert.deepEqual(rows.map((r) => [r.subcategory, r.totalAmount, r.transactionCount]), [["Groceries", 60, 2], ["Other", 7, 1], ["Coffee", 5, 1]]);
  assert.equal(spendBreakdown([tx("x", "2026-11-01", 1, "Shopping")], { category: "Food & Drink" }).length, 0);
});

test("categoryByMonth groups by month and category, oldest first", () => {
  const rows = categoryByMonth([
    tx("a", "2026-10-03", 10, "Food & Drink", "Coffee"),
    tx("b", "2026-11-03", 30, "Food & Drink", "Restaurants"),
    tx("c", "2026-11-04", 5, "Food & Drink", "Coffee"),
    tx("d", "2026-11-04", 50, "Shopping"),
  ], { category: "Food & Drink", bySubcategory: true });
  assert.deepEqual(rows.map((r) => [r.month, r.subcategory, r.spend]), [["2026-10", "Coffee", 10], ["2026-11", "Restaurants", 30], ["2026-11", "Coffee", 5]]);
});

test("topMerchants merges names that differ by reference numbers and ranks by spend", () => {
  const rows = topMerchants([
    tx("KEYBANK 11/13 #XXXXX9260", "2026-11-13", 3),
    tx("Amazon", "2026-11-01", 20),
    tx("Amazon", "2026-11-05", 30),
    tx("Shell 123456", "2026-11-02", 40),
    tx("Shell 987654", "2026-11-09", 41),
  ], { limit: 2 });
  assert.deepEqual(rows.map((r) => [r.merchant, r.totalAmount, r.transactionCount]), [["Shell 987654", 81, 2], ["Amazon", 50, 2]]);
  assert.equal(rows[0].lastDate, "2026-11-09");
});

test("spendingThisMonth compares month to date with the same days last month and a 3-month average", () => {
  const txs = [
    tx("a", "2026-08-05", 300, "Food & Drink"),
    tx("b", "2026-09-05", 300, "Food & Drink"),
    tx("c", "2026-10-05", 100, "Food & Drink"),
    tx("d", "2026-10-25", 200, "Food & Drink"), // after the 20th: last month, not last month to date
    tx("e", "2026-11-03", 150, "Food & Drink"),
    tx("f", "2026-11-21", 999, "Food & Drink"), // after today
    tx("pay", "2026-11-15", -2000, "Income & Payroll"),
  ];
  const r = spendingThisMonth(txs, TODAY);
  assert.deepEqual(
    [r.totals.spendSoFar, r.totals.lastMonthToDate, r.totals.lastMonth, r.totals.avg3Months, r.totals.monthsAveraged, r.totals.incomeSoFar, r.totals.netSoFar],
    [150, 100, 300, 300, 3, 2000, 1850],
  );
  assert.deepEqual(r.categories[0], { category: "Food & Drink", thisMonth: 150, lastMonthToDate: 100, lastMonth: 300, avg3Months: 300, changeVsLastMonthToDate: 50 });
});

test("spendingThisMonth averages only months the history fully covers", () => {
  const r = spendingThisMonth([tx("a", "2026-10-01", 90), tx("b", "2026-11-02", 10)], TODAY);
  assert.deepEqual([r.totals.monthsAveraged, r.totals.avg3Months], [1, 90]);
  // History that starts mid-month leaves that month out of the average.
  const mid = spendingThisMonth([tx("a", "2026-09-18", 50), tx("b", "2026-10-03", 80)], TODAY);
  assert.deepEqual([mid.totals.monthsAveraged, mid.totals.avg3Months], [1, 80]);
  assert.equal(spendingThisMonth([tx("a", "2026-11-02", 10)], TODAY).totals.avg3Months, null);
});

test("recurringIncome adds split deposits together and tolerates paydays that drift", () => {
  const pay = ["09-15", "09-30", "10-14", "10-29", "11-05", "11-13"].map((d, i) => tx("ACH Credit ADP TOTALSOURCE 4121031769 T7 - PAYROLL", `2026-${d}`, -(1691 + i), "Income & Payroll"));
  const split = ["05-14", "05-28", "06-12", "06-29", "07-14", "07-30", "08-13"].flatMap((d) => [
    tx("ACH Credit AUGER INC 1233303024 MW - PAYROLL", `2026-${d}`, -2983, "Income & Payroll"),
    tx("ACH Credit AUGER INC 1233303024 MW - PAYROLL", `2026-${d}`, -1988, "Income & Payroll"),
  ]);
  const inc = recurringIncome([...pay, ...split], TODAY);
  const adp = inc.find((i) => i.payer.includes("ADP"))!;
  assert.equal(adp.cadence, "biweekly");
  assert.equal(adp.active, true);
  const auger = inc.find((i) => i.payer.includes("AUGER"))!;
  assert.equal(auger.typicalAmount, 4971);
  assert.equal(auger.active, false, "a job that ended stops being expected");
});

test("upcoming projects each recurring bill and paycheck into the window", () => {
  const txs = [
    ...every("Spring Day Therapy", "2026-09-01", 7, 12, 200, "Medical"),
    ...every("Spotify", "2026-05-21", 30.5, 6, 20.99, "Entertainment"),
    ...every("Payroll Co", "2026-09-04", 14, 6, -1700, "Income & Payroll"),
  ];
  const items = upcoming(txs, TODAY, 14);
  assert.equal(items.filter((i) => i.name === "Spring Day Therapy").length, 2);
  assert.ok(items.some((i) => i.kind === "income" && i.name === "Payroll Co"));
  assert.ok(items.every((i) => i.date >= TODAY && i.date <= addDays(TODAY, 14)));
  assert.deepEqual(items.map((i) => i.date), [...items.map((i) => i.date)].sort());
});

test("safeToSpend is checking minus card balances minus bills before payday", () => {
  const accounts = [
    toAccount("c", { type: "depository", subtype: "checking", balance: 3000 }),
    toAccount("s", { type: "depository", subtype: "savings", balance: 50000 }),
    toAccount("cc", { type: "credit", subtype: "credit card", balance: 800 }),
    toAccount("i", { type: "investment", subtype: "ira", balance: 90000 }),
  ];
  const txs = [
    ...every("Payroll Co", "2026-09-04", 14, 6, -1700, "Income & Payroll"), // last 11-13, next 11-27
    ...every("Gym", "2026-06-24", 30, 5, 50, "Personal care"), // last 10-22, next 11-21
    ...every("Rent", "2026-06-02", 30.5, 6, 1500, "Housing & Rent"), // next early Dec, after payday
  ];
  const s = safeToSpend(accounts, txs, TODAY);
  assert.equal(s.nextPayday, "2026-11-27");
  assert.equal(s.checking, 3000);
  assert.equal(s.creditCardBalances, 800);
  assert.deepEqual(s.bills.map((b) => b.name), ["Gym"]);
  assert.equal(s.safeToSpend, 3000 - 800 - 50);
});

test("safeToSpend falls back to 14 days without a paycheck", () => {
  const s = safeToSpend([toAccount("c", { type: "depository", subtype: "checking", balance: 100 })], [], TODAY);
  assert.equal(s.nextPayday, null);
  assert.equal(s.until, addDays(TODAY, 14));
  assert.match(s.note, /No regular paycheck/);
});

test("worthALook flags fees, price increases, duplicates and unusual charges, but not rent", () => {
  const txs = [
    tx("Monthly Maintenance Fee", "2026-11-01", 12, "Bank fees"),
    tx("Late Fee", "2026-11-02", 25, "Other"),
    ...every("Spotify", "2026-06-21", 30, 4, 20.99, "Entertainment"),
    tx("Spotify", "2026-10-21", 22.99, "Entertainment"),
    tx("365 Vend", "2026-10-25", 7.6, "Food & Drink"),
    tx("365 Vend", "2026-10-25", 7.6, "Food & Drink"),
    ...every("PCC", "2026-05-01", 9, 15, 30, "Food & Drink"),
    tx("PCC", "2026-11-10", 240, "Food & Drink"),
    ...every("Venmo", "2026-06-02", 30.5, 5, 1750, "Other"),
    tx("Venmo", "2026-11-03", 1750, "Other"),
    tx("Brand New Store", "2026-11-04", 900, "Shopping"),
  ];
  const kinds = worthALook(txs, TODAY, 45).map((f) => `${f.kind}:${f.merchant}`);
  for (const k of ["fee:Monthly Maintenance Fee", "fee:Late Fee", "price_increase:Spotify", "duplicate:365 Vend", "large:PCC", "large:Brand New Store"]) {
    assert.ok(kinds.includes(k), `${k} in ${kinds.join(", ")}`);
  }
  assert.ok(!kinds.some((k) => k.endsWith(":Venmo")), "repeating rent is not unusual");
});
