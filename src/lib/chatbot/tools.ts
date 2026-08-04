import { dbAdapter, Account, Transaction } from '@/lib/db';

export interface QueryTransactionsParams {
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
  category?: string;
  subcategory?: string;
  merchant?: string;
  accountId?: string;
  limit?: number;
}

export interface AccountsSummary {
  accounts: Account[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

export interface SpendingCategorySummary {
  category: string;
  totalAmount: number;
  transactionCount: number;
}

/**
 * Tool: Fetch all user accounts and compute financial overview metrics.
 */
export async function getAccountsSummaryTool(): Promise<AccountsSummary> {
  const accounts = await dbAdapter.getAccounts();
  
  let totalAssets = 0;
  let totalLiabilities = 0;

  accounts.forEach((acc) => {
    const bal = acc.balance || 0;
    if (acc.type === 'credit' || acc.type === 'loan') {
      totalLiabilities += Math.abs(bal);
    } else {
      totalAssets += bal;
    }
  });

  return {
    accounts,
    totalAssets: Math.round(totalAssets * 100) / 100,
    totalLiabilities: Math.round(totalLiabilities * 100) / 100,
    netWorth: Math.round((totalAssets - totalLiabilities) * 100) / 100,
  };
}

/**
 * Tool: Query transactions with agent filters (date range, amount bounds, category, merchant search).
 * Enforces a maximum limit of 50 transactions to prevent payload/context overflow.
 */
export async function queryTransactionsTool(params: QueryTransactionsParams): Promise<{ count: number; transactions: Transaction[] }> {
  let allTx = await dbAdapter.getTransactions();

  if (params.startDate) {
    allTx = allTx.filter((t) => t.date >= params.startDate!);
  }
  if (params.endDate) {
    allTx = allTx.filter((t) => t.date <= params.endDate!);
  }
  if (params.minAmount !== undefined) {
    allTx = allTx.filter((t) => Math.abs(t.amount) >= params.minAmount!);
  }
  if (params.maxAmount !== undefined) {
    allTx = allTx.filter((t) => Math.abs(t.amount) <= params.maxAmount!);
  }
  if (params.category) {
    const catLower = params.category.toLowerCase();
    allTx = allTx.filter((t) => t.category.toLowerCase().includes(catLower));
  }
  if (params.subcategory) {
    const subLower = params.subcategory.toLowerCase();
    allTx = allTx.filter((t) => (t.subcategory || '').toLowerCase().includes(subLower));
  }
  if (params.merchant) {
    const merchLower = params.merchant.toLowerCase();
    allTx = allTx.filter((t) => t.name.toLowerCase().includes(merchLower));
  }
  if (params.accountId) {
    allTx = allTx.filter((t) => t.accountId === params.accountId);
  }

  // Sort descending by date
  allTx.sort((a, b) => (a.date > b.date ? -1 : 1));

  // Cap at 50 to avoid context token overload
  const limit = Math.min(params.limit || 50, 50);
  const truncated = allTx.slice(0, limit);

  return {
    count: allTx.length,
    transactions: truncated,
  };
}

/**
 * Tool: Aggregate spending totals grouped by category for a given date range.
 */
export async function getSpendingByCategoryTool(params: { startDate?: string; endDate?: string }): Promise<SpendingCategorySummary[]> {
  const { transactions } = await queryTransactionsTool({ ...params, limit: 1000 });
  const map: Record<string, { totalAmount: number; transactionCount: number }> = {};

  transactions.forEach((t) => {
    // Expense amounts are positive in Dinero schema
    if (t.amount > 0) {
      const cat = t.category || 'Uncategorized';
      if (!map[cat]) {
        map[cat] = { totalAmount: 0, transactionCount: 0 };
      }
      map[cat].totalAmount += t.amount;
      map[cat].transactionCount += 1;
    }
  });

  return Object.entries(map)
    .map(([category, val]) => ({
      category,
      totalAmount: Math.round(val.totalAmount * 100) / 100,
      transactionCount: val.transactionCount,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

// Structured Tool Declarations for LLM Function Calling
export const CHATBOT_TOOLS_SCHEMA = [
  {
    name: 'get_accounts_summary',
    description: 'Retrieves all user bank/credit/investment accounts, current balances, total assets, total liabilities, and net worth.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'query_transactions',
    description: 'Queries user transactions with filters such as date range, min/max amount, category, subcategory, and merchant substring.',
    parameters: {
      type: 'OBJECT',
      properties: {
        startDate: { type: 'STRING', description: 'Filter start date in YYYY-MM-DD format.' },
        endDate: { type: 'STRING', description: 'Filter end date in YYYY-MM-DD format.' },
        minAmount: { type: 'STRING', description: 'Minimum transaction amount.' },
        maxAmount: { type: 'STRING', description: 'Maximum transaction amount.' },
        category: { type: 'STRING', description: 'Category name filter (e.g. Dining, Groceries, Shopping, Travel).' },
        subcategory: { type: 'STRING', description: 'Subcategory name filter.' },
        merchant: { type: 'STRING', description: 'Merchant or transaction description search string.' },
        limit: { type: 'STRING', description: 'Maximum number of transactions to return (max 50).' },
      },
    },
  },
  {
    name: 'get_spending_by_category',
    description: 'Computes total expense spending aggregated by category for a date range.',
    parameters: {
      type: 'OBJECT',
      properties: {
        startDate: { type: 'STRING', description: 'Start date in YYYY-MM-DD format.' },
        endDate: { type: 'STRING', description: 'End date in YYYY-MM-DD format.' },
      },
    },
  },
];
