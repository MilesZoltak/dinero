import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MAX_ROWS, monthlyTrend, netWorthHistory, queryTransactions, recurringCharges, spendByCategory, summarizeAccounts } from "./analysis.ts";
import { localDate } from "./sync.ts";
import { categoryByMonth, safeToSpend, spendBreakdown, spendingThisMonth, topMerchants, upcoming, worthALook } from "./insights.ts";
import { isTransferCategory } from "./categorize.ts";
import type { Store } from "./store.ts";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("Date as YYYY-MM-DD");

const range = {
  startDate: date.optional().describe("Start date, inclusive (YYYY-MM-DD)."),
  endDate: date.optional().describe("End date, inclusive (YYYY-MM-DD)."),
};

const withTransfers = {
  ...range,
  includeTransfers: z
    .boolean()
    .optional()
    .describe("Include transfers between your own accounts, such as credit card payments and savings moves. Default false."),
};

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });

export function registerTools(server: McpServer, store: Store) {
  server.registerTool(
    "ping",
    { description: "Connectivity check. Returns 'pong' and the server time. Contains no financial data.", annotations: readOnly },
    async () => json({ reply: "pong", serverTime: new Date().toISOString() }),
  );

  server.registerTool(
    "get_accounts_summary",
    {
      description:
        "All accounts with current balances, plus total assets, total liabilities and net worth. Credit and loan balances count as liabilities.",
      annotations: readOnly,
    },
    async () => json(summarizeAccounts(await store.getAccounts())),
  );

  server.registerTool(
    "query_transactions",
    {
      description: `Search transactions, newest first. Amounts: positive is an expense, negative is income. Returns at most ${MAX_ROWS} rows; totalMatches says how many matched overall.`,
      inputSchema: {
        ...range,
        category: z.string().optional().describe("Category contains this text."),
        subcategory: z.string().optional().describe("Subcategory contains this text."),
        merchant: z.string().optional().describe("Transaction name contains this text."),
        accountId: z.string().optional().describe("Exact account id, from get_accounts_summary."),
        minAmount: z.number().optional().describe("Minimum absolute amount."),
        maxAmount: z.number().optional().describe("Maximum absolute amount."),
        limit: z.number().int().min(1).max(MAX_ROWS).optional().describe("Rows to return (default 50)."),
      },
      annotations: readOnly,
    },
    async ({ startDate, endDate, ...q }) => json(queryTransactions(await store.getTransactions({ startDate, endDate }), q)),
  );

  server.registerTool(
    "spend_by_category",
    {
      description:
        "Total expenses per category over a date range, largest first. Counts every transaction in the range, not a sample. With bySubcategory, one row per category and subcategory (for example Food & Drink: Groceries, Restaurants, Coffee, Fast food); category limits it to one category. Transfers between your own accounts are left out unless includeTransfers is true.",
      inputSchema: {
        ...withTransfers,
        bySubcategory: z.boolean().optional().describe("Break each category down by subcategory. Default false."),
        category: z.string().optional().describe("Only this category, exact name such as \"Food & Drink\"."),
      },
      annotations: readOnly,
    },
    async ({ includeTransfers, bySubcategory, category, ...r }) => {
      const all = await store.getTransactions(r);
      const txs = (includeTransfers ? all : all.filter((t) => !isTransferCategory(t.category))).filter((t) => !category || t.category === category);
      return json(bySubcategory ? spendBreakdown(txs) : spendByCategory(txs));
    },
  );

  server.registerTool(
    "monthly_trend",
    {
      description:
        "Spend, income and net per calendar month over a date range, oldest first. Transfers between your own accounts are left out unless includeTransfers is true.",
      inputSchema: withTransfers,
      annotations: readOnly,
    },
    async ({ includeTransfers, ...r }) => {
      const txs = await store.getTransactions(r);
      return json(monthlyTrend(includeTransfers ? txs : txs.filter((t) => !isTransferCategory(t.category))));
    },
  );

  server.registerTool(
    "net_worth_history",
    {
      description:
        "Net worth, total assets and total liabilities per day, oldest first, from the balance snapshot each daily sync saves. History starts on the first snapshot; there is none before that. change is the last point minus the first.",
      inputSchema: {
        ...range,
        includeAccounts: z.boolean().optional().describe("Also return each account's balance per day. Default false."),
      },
      annotations: readOnly,
    },
    async ({ includeAccounts, ...r }) => json(netWorthHistory(await store.getBalanceSnapshots(r), { includeAccounts })),
  );

  server.registerTool(
    "recurring_charges",
    {
      description:
        "Subscriptions and other charges that repeat on a schedule (weekly, biweekly, monthly, quarterly, yearly), found from transaction history. Each has its typical amount, cadence, last and next expected date, and annual cost; estimatedMonthlyTotal sums the active ones. Transfers between your own accounts are left out. Detection is heuristic: a charge needs about three regular occurrences before it shows up.",
      inputSchema: {
        lookbackMonths: z.number().int().min(3).max(36).optional().describe("How far back to look. Default 13, so yearly charges can appear."),
        includeInactive: z.boolean().optional().describe("Also list charges that seem to have stopped. Default false."),
      },
      annotations: readOnly,
    },
    async ({ lookbackMonths, includeInactive }) => {
      const today = localDate(new Date().toISOString());
      const start = new Date(Date.parse(today));
      start.setUTCMonth(start.getUTCMonth() - (lookbackMonths ?? 13));
      const txs = await store.getTransactions({ startDate: start.toISOString().slice(0, 10) });
      return json(recurringCharges(txs.filter((t) => !isTransferCategory(t.category)), today, { includeInactive }));
    },
  );

  const today = () => localDate(new Date().toISOString());
  const monthsBack = (n: number) => {
    const d = new Date(Date.parse(today()));
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1)).toISOString().slice(0, 10);
  };
  const spending = async (startDate: string) => (await store.getTransactions({ startDate })).filter((t) => !isTransferCategory(t.category));

  server.registerTool(
    "spending_by_month",
    {
      description:
        "Spend per calendar month for each category (or each subcategory), oldest month first, one row per month and category. Use it to see how a category such as eating out or groceries changes over time. Transfers are left out.",
      inputSchema: {
        ...range,
        category: z.string().optional().describe("Only this category, exact name such as \"Food & Drink\"."),
        bySubcategory: z.boolean().optional().describe("One row per month, category and subcategory. Default false."),
      },
      annotations: readOnly,
    },
    async ({ category, bySubcategory, ...r }) => {
      const txs = (await store.getTransactions(r)).filter((t) => !isTransferCategory(t.category));
      return json(categoryByMonth(txs, { category, bySubcategory }));
    },
  );

  server.registerTool(
    "top_merchants",
    {
      description: "Where the money goes: payees ranked by total spend over a date range, with how many charges, the last date, and each one's share of spend. Transfers are left out.",
      inputSchema: {
        ...range,
        category: z.string().optional().describe("Only this category, exact name such as \"Food & Drink\"."),
        limit: z.number().int().min(1).max(50).optional().describe("How many payees (default 15)."),
      },
      annotations: readOnly,
    },
    async ({ category, limit, ...r }) => {
      const txs = (await store.getTransactions(r)).filter((t) => !isTransferCategory(t.category));
      return json(topMerchants(txs, { category, limit }));
    },
  );

  server.registerTool(
    "spending_this_month",
    {
      description:
        "This month so far compared with the same days of last month, all of last month, and the average of the three full months before this one, in total and per category. Also income and net so far. Transfers are left out.",
      annotations: readOnly,
    },
    async () => json(spendingThisMonth(await spending(monthsBack(3)), today())),
  );

  server.registerTool(
    "upcoming",
    {
      description: "Recurring bills and expected income (such as paychecks) in the next days, soonest first, projected from transaction history. Amounts are typical, not exact.",
      inputSchema: { days: z.number().int().min(1).max(60).optional().describe("How many days ahead (default 14).") },
      annotations: readOnly,
    },
    async ({ days }) => json(upcoming(await spending(monthsBack(13)), today(), days ?? 14)),
  );

  server.registerTool(
    "safe_to_spend",
    {
      description:
        "An estimate of what is safe to spend before the next paycheck: cash in checking, minus credit card balances, minus recurring bills expected before payday. Savings and investments are not counted. Returns the parts so the estimate can be explained.",
      annotations: readOnly,
    },
    async () => json(safeToSpend(await store.getAccounts(), await spending(monthsBack(13)), today())),
  );

  server.registerTool(
    "worth_a_look",
    {
      description:
        "Recent things worth checking: fees and interest charges, subscription price increases, possible duplicate charges, and charges far above what that payee usually costs. Heuristic; each item says why it was flagged.",
      inputSchema: { days: z.number().int().min(7).max(180).optional().describe("How far back to flag (default 45).") },
      annotations: readOnly,
    },
    async ({ days }) => json(worthALook(await spending(monthsBack(9)), today(), days ?? 45)),
  );
}
