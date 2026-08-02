import { NextResponse } from 'next/server';
import { plaidClient, isPlaidEnabled } from '@/lib/plaidClient';
import { dbAdapter, Account, PlaidItem } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { public_token, institution, isMock } = await request.json();

    const instName = institution?.name || 'Mock Financial Bank';
    const instId = institution?.institution_id || 'ins_mock';

    if (!isPlaidEnabled() || isMock || public_token.startsWith('mock_')) {
      // Mock Exchange Flow
      const mockItemId = 'item_' + Math.random().toString(36).substr(2, 9);
      
      // Save mock item
      const mockPlaidItem: PlaidItem = {
        itemId: mockItemId,
        accessToken: 'mock_access_token_' + Math.random().toString(36).substr(2, 9),
        institutionId: instId,
        institutionName: instName,
      };
      await dbAdapter.savePlaidItem(mockPlaidItem);

      // Create realistic mock accounts depending on the bank selected
      const mockAccounts: Account[] = [];
      const lowerName = instName.toLowerCase();

      if (lowerName.includes('chase') || lowerName.includes('bank of america') || lowerName.includes('wellsfargo') || lowerName.includes('citi')) {
        // depository checking
        mockAccounts.push({
          id: 'acc_checking_' + Math.random().toString(36).substr(2, 9),
          name: 'Total Checking',
          mask: '4302',
          type: 'depository',
          subtype: 'checking',
          balance: 5430.22,
          institutionName: instName,
          isManual: false,
          itemId: mockItemId,
          lastSync: new Date().toISOString(),
        });
        // credit card
        mockAccounts.push({
          id: 'acc_credit_' + Math.random().toString(36).substr(2, 9),
          name: 'Premium Rewards Card',
          mask: '9821',
          type: 'credit',
          subtype: 'credit card',
          balance: 1420.50, // Positive balance on credit card typically means balance owed (liability)
          limit: 15000,
          institutionName: instName,
          isManual: false,
          itemId: mockItemId,
          lastSync: new Date().toISOString(),
        });
      } else if (lowerName.includes('fidelity') || lowerName.includes('vanguard') || lowerName.includes('schwab')) {
        // investment brokerage
        mockAccounts.push({
          id: 'acc_brokerage_' + Math.random().toString(36).substr(2, 9),
          name: 'Individual Brokerage',
          mask: '1105',
          type: 'investment',
          subtype: 'brokerage',
          balance: 42150.75,
          institutionName: instName,
          isManual: false,
          itemId: mockItemId,
          lastSync: new Date().toISOString(),
        });
        // 401k
        mockAccounts.push({
          id: 'acc_retirement_' + Math.random().toString(36).substr(2, 9),
          name: 'Pre-Tax 401(k)',
          mask: '8872',
          type: 'investment',
          subtype: '401k',
          balance: 128500.00,
          institutionName: instName,
          isManual: false,
          itemId: mockItemId,
          lastSync: new Date().toISOString(),
        });
      } else if (lowerName.includes('ally') || lowerName.includes('marcus') || lowerName.includes('wealthfront') || lowerName.includes('sofi')) {
        // HYSA savings
        mockAccounts.push({
          id: 'acc_savings_' + Math.random().toString(36).substr(2, 9),
          name: 'High Yield Savings Account',
          mask: '3391',
          type: 'depository',
          subtype: 'savings', // HYSA is classified as savings
          balance: 24500.35,
          institutionName: instName,
          isManual: false,
          itemId: mockItemId,
          lastSync: new Date().toISOString(),
        });
      } else {
        // Default mock account
        mockAccounts.push({
          id: 'acc_default_' + Math.random().toString(36).substr(2, 9),
          name: 'Checking Account',
          mask: '0012',
          type: 'depository',
          subtype: 'checking',
          balance: 1500.00,
          institutionName: instName,
          isManual: false,
          itemId: mockItemId,
          lastSync: new Date().toISOString(),
        });
      }

      // Save all mock accounts
      for (const account of mockAccounts) {
        await dbAdapter.saveAccount(account);
      }

      // Pre-fill some mock transactions so they show up in the transaction feed
      const mockTransactions = generateMockTransactions(mockAccounts);
      await dbAdapter.saveTransactions(mockTransactions);

      return NextResponse.json({ success: true, isMock: true });
    }

    // Real Exchange Flow
    const exchangeResponse = await plaidClient!.itemPublicTokenExchange({
      public_token,
    });
    const { access_token, item_id } = exchangeResponse.data;

    // Save Plaid Item to database
    const plaidItem: PlaidItem = {
      itemId: item_id,
      accessToken: access_token,
      institutionId: instId,
      institutionName: instName,
    };
    await dbAdapter.savePlaidItem(plaidItem);

    // Fetch and save accounts immediately
    const accountsResponse = await plaidClient!.accountsGet({
      access_token,
    });
    const plaidAccounts = accountsResponse.data.accounts;

    for (const acc of plaidAccounts) {
      await dbAdapter.saveAccount({
        id: acc.account_id,
        name: acc.name,
        mask: acc.mask || null,
        type: acc.type,
        subtype: acc.subtype || '',
        balance: acc.balances.current || 0,
        limit: acc.balances.limit || null,
        institutionName: instName,
        isManual: false,
        itemId: item_id,
        lastSync: new Date().toISOString(),
      });
    }

    // Trigger sync for new transactions
    // Since we'll write the sync API separately, we will call sync logic directly or let the client trigger a sync.
    // Let's do transaction fetching in the sync endpoint.

    return NextResponse.json({ success: true, isMock: false });
  } catch (error: any) {
    console.error('Error exchanging Plaid Token:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to exchange token' },
      { status: 500 }
    );
  }
}

// Generate rich, realistic mock transactions for local testing
function generateMockTransactions(accounts: Account[]) {
  const transactions: any[] = [];
  const categories = ['Food & Drink', 'Rent & Housing', 'Shopping', 'Travel', 'Income', 'Investments', 'Utilities'];
  
  accounts.forEach((acc) => {
    if (acc.subtype === 'checking' || acc.subtype === 'credit card') {
      const isCard = acc.subtype === 'credit card';
      
      // Rent transaction (to address Rocket Money pain point)
      if (acc.subtype === 'checking') {
        transactions.push({
          id: 'tx_rent_' + Math.random().toString(36).substr(2, 9),
          accountId: acc.id,
          amount: 2200.00, // Positive for rent expense
          date: getRelativeDateStr(-2), // 2 days ago
          name: 'Monthly Rent Payment',
          category: 'Rent & Housing',
          isPending: false,
          isManual: false,
        });
      }

      // Add a few daily expenses
      transactions.push({
        id: 'tx_coffee_' + Math.random().toString(36).substr(2, 9),
        accountId: acc.id,
        amount: 6.75,
        date: getRelativeDateStr(0), // Today
        name: 'Blue Bottle Coffee',
        category: 'Food & Drink',
        isPending: true,
        isManual: false,
      });

      transactions.push({
        id: 'tx_grocery_' + Math.random().toString(36).substr(2, 9),
        accountId: acc.id,
        amount: 84.50,
        date: getRelativeDateStr(-1), // Yesterday
        name: 'Whole Foods Market',
        category: 'Food & Drink',
        isPending: false,
        isManual: false,
      });

      transactions.push({
        id: 'tx_netflix_' + Math.random().toString(36).substr(2, 9),
        accountId: acc.id,
        amount: 15.49,
        date: getRelativeDateStr(-4),
        name: 'Netflix Subscription',
        category: 'Utilities',
        isPending: false,
        isManual: false,
      });

      if (acc.subtype === 'checking') {
        // Paycheck income
        transactions.push({
          id: 'tx_salary_' + Math.random().toString(36).substr(2, 9),
          accountId: acc.id,
          amount: -3500.00, // Negative for credit/income
          date: getRelativeDateStr(-5),
          name: 'Employer Payroll / Direct Deposit',
          category: 'Income',
          isPending: false,
          isManual: false,
        });
      }
    } else if (acc.subtype === 'brokerage' || acc.subtype === '401k') {
      // Add a contribution or market gain
      transactions.push({
        id: 'tx_contrib_' + Math.random().toString(36).substr(2, 9),
        accountId: acc.id,
        amount: -250.00, // contribution (positive change in balance, reported as credit/income in feed)
        date: getRelativeDateStr(-3),
        name: 'Periodic Contribution',
        category: 'Investments',
        isPending: false,
        isManual: false,
      });
    }
  });

  return transactions;
}

function getRelativeDateStr(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().split('T')[0];
}
