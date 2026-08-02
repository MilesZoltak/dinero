import { NextResponse } from 'next/server';
import { dbAdapter, SimpleFinConnection } from '@/lib/db';
import { categorizeTransaction, seedDefaultRules } from '@/lib/categorizer';

export async function POST(request: Request) {
  try {
    const { setupToken } = await request.json();

    if (!setupToken) {
      return NextResponse.json({ error: 'Setup Token is required' }, { status: 400 });
    }

    // 1. Base64 decode the setup token to get the claim URL
    let claimUrl: string;
    try {
      claimUrl = Buffer.from(setupToken, 'base64').toString('utf-8');
      // Basic sanity check to ensure it's a valid URL
      if (!claimUrl.startsWith('http')) {
        throw new Error('Decoded token is not a valid URL');
      }
    } catch (err) {
      return NextResponse.json(
        { error: 'Invalid Setup Token format. Make sure you copied it correctly.' },
        { status: 400 }
      );
    }

    // 2. POST to the claim URL with a Content-Length: 0 header
    const response = await fetch(claimUrl, {
      method: 'POST',
      headers: {
        'Content-Length': '0',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Failed to claim SimpleFIN token: ${response.statusText} (${errorText})` },
        { status: response.status }
      );
    }

    // 3. The response body is the permanent Access URL
    const accessUrl = await response.text();

    if (!accessUrl || !accessUrl.startsWith('http')) {
      return NextResponse.json(
        { error: 'Plaid/SimpleFIN server did not return a valid Access URL.' },
        { status: 500 }
      );
    }

    // 4. Save the SimpleFIN connection
    const connectionId = 'sfin_' + Math.random().toString(36).substr(2, 9);
    const newConnection: SimpleFinConnection = {
      id: connectionId,
      accessUrl: accessUrl.trim(),
      orgName: 'SimpleFIN Feed',
    };

    await dbAdapter.saveSimpleFinConnection(newConnection);

    // 5. Trigger initial sync for accounts/transactions (we will run the sync logic in the background or trigger it)
    // To be fast, let's trigger it immediately so that the user sees accounts immediately after linking
    try {
      await syncSimpleFinData(newConnection);
    } catch (syncErr: any) {
      console.error('Initial SimpleFIN sync failed:', syncErr);
      // We still return success since the token was successfully claimed and saved
    }

    return NextResponse.json({ success: true, connectionId });
  } catch (error: any) {
    console.error('SimpleFIN link error:', error);
    return NextResponse.json(
      { error: error.message || 'An unexpected error occurred while linking SimpleFIN' },
      { status: 500 }
    );
  }
}

// SimpleFIN Sync helper
export async function syncSimpleFinData(conn: SimpleFinConnection) {
  await seedDefaultRules();
  const rules = await dbAdapter.getCategoryRules();

  // Query 90 days of historical transactions (SimpleFIN protocol max limit for a single query)
  const startTimestamp = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000);
  const accountsUrl = `${conn.accessUrl}/accounts?version=2&start-date=${startTimestamp}`;
  
  // Parse credentials from URL since native fetch fails on credentials embedded in URLs
  const urlObj = new URL(accountsUrl);
  const username = urlObj.username;
  const password = urlObj.password;
  urlObj.username = '';
  urlObj.password = '';
  const cleanedUrl = urlObj.toString();
  
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  
  const res = await fetch(cleanedUrl, { 
    method: 'GET',
    headers: {
      'Authorization': authHeader,
    }
  });

  if (!res.ok) {
    throw new Error(`SimpleFIN pull failed: ${res.statusText}`);
  }

  const data = await res.json();
  const simpleFinAccounts = data.accounts || [];
  const connections = data.connections || [];

  for (const sAcc of simpleFinAccounts) {
    // 1. Locate connection name for this account to group correctly
    const connInfo = connections.find((c: any) => c.conn_id === sAcc.conn_id);
    const institutionName = connInfo?.name || connInfo?.org_name || sAcc.org?.name || conn.orgName;

    // 2. Determine mapping types (SimpleFIN doesn't provide a strict account classification field)
    let type = 'depository'; // default to depository
    let subtype = 'checking'; // default to checking

    const lowerName = sAcc.name.toLowerCase();
    
    // Check names first to align with user expectations (e.g., "SimpleFIN Savings" -> Savings account)
    if (lowerName.includes('hysa') || lowerName.includes('high yield') || lowerName.includes('high-yield') || lowerName.includes('online savings') || lowerName.includes('marcus')) {
      type = 'depository';
      subtype = 'hysa';
    } else if (lowerName.includes('savings')) {
      type = 'depository';
      subtype = 'savings';
    } else if (lowerName.includes('checking') || lowerName.includes('draft') || lowerName.includes('spend')) {
      type = 'depository';
      subtype = 'checking';
    } else if (lowerName.includes('credit card') || lowerName.includes('credit-card') || lowerName.includes('card') || lowerName.includes('visa') || lowerName.includes('mastercard') || lowerName.includes('amex')) {
      type = 'credit';
      subtype = 'credit card';
    } else if (lowerName.includes('401k') || lowerName.includes('401(k)') || lowerName.includes('retirement') || lowerName.includes('ira') || lowerName.includes('roth') || lowerName.includes('investment') || lowerName.includes('brokerage')) {
      type = 'investment';
      subtype = lowerName.includes('401k') ? '401k' : lowerName.includes('ira') ? 'ira' : 'brokerage';
    } else if (lowerName.includes('mortgage') || lowerName.includes('loan') || lowerName.includes('debt')) {
      type = 'loan';
      subtype = lowerName.includes('mortgage') ? 'mortgage' : 'other';
    } else if (lowerName.includes('hsa') || lowerName.includes('health savings')) {
      type = 'depository';
      subtype = 'hsa';
    }
    // Check holdings fallback if name didn't specify
    else if (sAcc.holdings && Array.isArray(sAcc.holdings) && sAcc.holdings.length > 0) {
      type = 'investment';
      subtype = 'brokerage';
    }

    const internalAccountId = `sfin_acc_${sAcc.id}`;
    
    // Save account
    await dbAdapter.saveAccount({
      id: internalAccountId,
      name: sAcc.name,
      mask: null,
      type,
      subtype,
      balance: parseFloat(sAcc.balance) || 0,
      institutionName,
      isManual: false,
      itemId: conn.id, // Linked to SimpleFIN Connection ID
      lastSync: new Date().toISOString(),
    });

    // Save transactions
    if (sAcc.transactions && Array.isArray(sAcc.transactions)) {
      const txsToSave = sAcc.transactions.map((stx: any) => {
        // Convert Unix timestamp (epoch in seconds) to YYYY-MM-DD
        const date = new Date(stx.posted * 1000).toISOString().split('T')[0];
        // Negate amount to match Plaid style (negative = income, positive = expense)
        const amount = -parseFloat(stx.amount);

        let name = stx.description || 'Transaction';
        if (stx.memo && stx.memo !== name) {
          name = `${name} (${stx.memo})`;
        }

        return {
          id: `sfin_tx_${stx.id}`,
          accountId: internalAccountId,
          amount,
          date,
          name,
          category: categorizeTransaction(name, rules),
          isPending: stx.pending || false,
          isManual: false,
        };
      });

      if (txsToSave.length > 0) {
        await dbAdapter.saveTransactions(txsToSave);
      }
    }
  }
}
