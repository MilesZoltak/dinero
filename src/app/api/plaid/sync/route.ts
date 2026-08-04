import { NextResponse } from 'next/server';
import { getPlaidClient, isPlaidEnabled } from '@/lib/plaidClient';
import { dbAdapter, Account, Transaction, PlaidItem } from '@/lib/db';

export async function POST() {
  try {
    const plaidItems = await dbAdapter.getPlaidItems();
    const accounts = await dbAdapter.getAccounts();

    if (plaidItems.length === 0) {
      return NextResponse.json({
        message: 'No connected accounts to sync. Please link an institution first.',
        syncedCount: 0,
      });
    }

    let syncedItemsCount = 0;
    const dateToday = new Date().toISOString().split('T')[0];

    // 1. Sync Plaid Feeds (Mock or Real)
    for (const item of plaidItems) {
      if (!isPlaidEnabled() || item.accessToken.startsWith('mock_')) {
        // --- Mock Sync Logic ---
        const itemAccounts = accounts.filter((a) => a.itemId === item.itemId);
        
        for (const acc of itemAccounts) {
          if (acc.subtype === 'checking') {
            acc.balance += parseFloat((Math.random() * 20 - 10).toFixed(2));
          } else if (acc.subtype === 'credit card') {
            acc.balance += parseFloat((Math.random() * 15).toFixed(2));
          } else if (acc.subtype === 'brokerage' || acc.subtype === '401k') {
            const pct = (Math.random() * 1.5 - 0.5) / 100;
            acc.balance = parseFloat((acc.balance * (1 + pct)).toFixed(2));
          }
          acc.lastSync = new Date().toISOString();
          await dbAdapter.saveAccount(acc);
        }

        if (Math.random() < 0.4 && itemAccounts.length > 0) {
          const randomAcc = itemAccounts[Math.floor(Math.random() * itemAccounts.length)];
          if (randomAcc.subtype === 'checking' || randomAcc.subtype === 'credit card') {
            const merchants = ['Starbucks', 'Uber', 'Amazon', 'Trader Joe\'s', 'Steam Games', 'Chevron'];
            const categories = ['Food & Drink', 'Travel', 'Shopping', 'Food & Drink', 'Shopping', 'Travel'];
            const idx = Math.floor(Math.random() * merchants.length);
            
            const newTx: Transaction = {
              id: 'tx_sync_' + Math.random().toString(36).substr(2, 9),
              accountId: randomAcc.id,
              amount: parseFloat((Math.random() * 45 + 5).toFixed(2)),
              date: dateToday,
              name: merchants[idx],
              category: categories[idx],
              isPending: false,
              isManual: false,
            };
            await dbAdapter.saveTransaction(newTx);
          }
        }
        
        syncedItemsCount++;
        continue;
      }

      // --- Real Plaid Sync ---
      try {
        const plaidClient = getPlaidClient();
        const accessToken = item.accessToken;
        const accountsResponse = await plaidClient!.accountsGet({ access_token: accessToken });
        const plaidAccounts = accountsResponse.data.accounts;

        for (const pAcc of plaidAccounts) {
          const updatedAcc: Account = {
            id: pAcc.account_id,
            name: pAcc.name,
            mask: pAcc.mask || null,
            type: pAcc.type,
            subtype: pAcc.subtype || '',
            balance: pAcc.balances.current || 0,
            limit: pAcc.balances.limit || null,
            institutionName: item.institutionName,
            isManual: false,
            itemId: item.itemId,
            lastSync: new Date().toISOString(),
          };

          await dbAdapter.saveAccount(updatedAcc);
        }

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        const startDateStr = startDate.toISOString().split('T')[0];

        const transactionsResponse = await plaidClient!.transactionsGet({
          access_token: accessToken,
          start_date: startDateStr,
          end_date: dateToday,
          options: { count: 100 }
        });

        const plaidTransactions = transactionsResponse.data.transactions;
        const txsToSave: Transaction[] = plaidTransactions.map((ptx) => {
          return {
            id: ptx.transaction_id,
            accountId: ptx.account_id,
            amount: ptx.amount,
            date: ptx.date,
            name: ptx.merchant_name || ptx.name,
            category: ptx.personal_finance_category?.primary || ptx.category?.[0] || 'Uncategorized',
            isPending: ptx.pending || false,
            isManual: false,
          };
        });

        if (txsToSave.length > 0) {
          await dbAdapter.saveTransactions(txsToSave);
        }

        syncedItemsCount++;
      } catch (innerError: any) {
        console.error(`Failed to sync Plaid item ${item.itemId} (${item.institutionName}):`, innerError);
      }
    }

    // Retrieve fresh lists
    const updatedAccounts = await dbAdapter.getAccounts();
    const updatedTransactions = await dbAdapter.getTransactions();

    return NextResponse.json({
      message: `Successfully synced ${syncedItemsCount} institution(s).`,
      syncedCount: syncedItemsCount,
      accounts: updatedAccounts,
      transactions: updatedTransactions,
    });
  } catch (error: any) {
    console.error('Global sync error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sync data' },
      { status: 500 }
    );
  }
}

