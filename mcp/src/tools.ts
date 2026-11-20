import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MAX_ROWS, monthlyTrend, netWorthHistory, queryTransactions, spendByCategory, summarizeAccounts } from "./analysis.ts";
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
        "Total expenses per category over a date range, largest first. Counts every transaction in the range, not a sample. Transfers between your own accounts are left out unless includeTransfers is true.",
      inputSchema: withTransfers,
      annotations: readOnly,
    },
    async ({ includeTransfers, ...r }) => {
      const txs = await store.getTransactions(r);
      return json(spendByCategory(includeTransfers ? txs : txs.filter((t) => !isTransferCategory(t.category))));
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
}
