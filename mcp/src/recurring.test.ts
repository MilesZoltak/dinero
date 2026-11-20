import assert from "node:assert/strict";
import { test } from "node:test";
import { merchantKey, recurringCharges } from "./analysis.ts";
import type { Transaction } from "./store.ts";

let n = 0;
const tx = (name: string, date: string, amount: number, category = "Shopping"): Transaction => ({
  id: String(n++), accountId: "a", amount, date, name, category, subcategory: null, isPending: false,
});
const addDays = (d: string, k: number) => new Date(Date.parse(d) + k * 86_400_000).toISOString().slice(0, 10);
const series = (name: string, start: string, step: number, count: number, amount: number | ((i: number) => number), skip: number[] = []) =>
  Array.from({ length: count }, (_, i) => i)
    .filter((i) => !skip.includes(i))
    .map((i) => tx(name, addDays(start, i * step), typeof amount === "number" ? amount : amount(i)));
const TODAY = "2026-11-20";
const find = (r: ReturnType<typeof recurringCharges>, name: string) => r.charges.find((c) => c.merchant === name);

test("finds a monthly subscription despite a one-off price and a skipped month", () => {
  const txs = [...series("Google One", "2026-05-19", 30.5, 7, 19.99, [4]), tx("Google One", "2026-05-29", 24.99)];
  const c = find(recurringCharges(txs, TODAY), "Google One")!;
  assert.equal(c.cadence, "monthly");
  assert.equal(c.typicalAmount, 19.99);
  assert.equal(c.occurrences, 6);
  assert.equal(c.annualCost, 239.88);
  assert.equal(c.active, true);
});

test("finds a weekly charge with skipped weeks, and rent paid on a loose schedule", () => {
  const therapy = series("Spring Day Therapy", "2026-05-05", 7, 28, 200, [2, 9, 19, 20]);
  const rent = ["06-02", "07-01", "08-03", "09-02", "10-09", "11-03"].map((d) => tx("Venmo", `2026-${d}`, 1750, "Other"));
  const noise = ["06-05", "06-20", "07-11", "08-14", "09-09", "10-21", "11-19"].map((d, i) => tx("Venmo", `2026-${d}`, 20 + i * 13, "Other"));
  const r = recurringCharges([...therapy, ...rent, ...noise], TODAY);
  assert.equal(find(r, "Spring Day Therapy")?.cadence, "weekly");
  assert.equal(find(r, "Venmo")?.typicalAmount, 1750);
  assert.equal(r.charges.filter((c) => c.merchant === "Venmo").length, 1);
});

test("finds a metered monthly bill whose amount varies", () => {
  const txs = series("Railway", "2026-05-26", 30.4, 6, (i) => [32.1, 31.03, 33.59, 45.42, 46.18, 45.65][i]);
  const c = find(recurringCharges(txs, TODAY), "Railway")!;
  assert.equal(c.cadence, "monthly");
  assert.equal(c.amountVaries, true);
});

test("ignores frequent but irregular shopping, and similar-but-not-identical amounts", () => {
  const amazon = Array.from({ length: 50 }, (_, i) => tx("Amazon", addDays("2026-05-04", Math.floor(i * 3.7)), 5 + ((i * 37) % 90)));
  const cafe = Array.from({ length: 40 }, (_, i) => tx("Cafe Anclair", addDays("2026-05-04", i * 4 + (i % 3)), 10.1));
  const restaurant = ["05-27", "06-21", "07-19", "08-28"].map((d, i) => tx("Tavolata", `2026-${d}`, [49.07, 112.09, 98.16, 45.76][i]));
  // Monthly-ish big shops mixed in with smaller trips, as real grocery history looks.
  const groceries = [...series("Grocery Outlet", "2026-05-10", 30, 6, (i) => 55 + i * 0.7), ...series("Grocery Outlet", "2026-05-14", 9, 18, (i) => 12 + (i * 7) % 30)];
  const r = recurringCharges([...amazon, ...cafe, ...restaurant, ...groceries], TODAY);
  assert.deepEqual(r.charges.map((c) => c.merchant), []);
});

test("stopped charges are hidden unless asked for; income and pending rows are ignored", () => {
  const stopped = series("World Wildlife Fnd", "2026-05-15", 31, 5, 25);
  const payroll = series("Payroll", "2026-05-01", 14, 12, -2000);
  const pending = series("Pending Sub", "2026-08-01", 30, 4, 9.99).map((t) => ({ ...t, isPending: true }));
  assert.equal(recurringCharges([...stopped, ...payroll, ...pending], TODAY).charges.length, 0);
  const all = recurringCharges(stopped, TODAY, { includeInactive: true });
  assert.equal(all.charges[0].active, false);
  assert.equal(all.estimatedMonthlyTotal, 0);
});

test("merchantKey drops reference numbers and punctuation", () => {
  assert.equal(merchantKey("ACH Credit AUGER INC 1233303024 MW - PAYROLL"), "ach credit auger inc mw payroll");
  assert.equal(merchantKey("Zelle payment from X Conf# T22RFKLHC"), "zelle payment from x");
  assert.equal(merchantKey("Dick's Drive-in"), "dick s drive in");
});
