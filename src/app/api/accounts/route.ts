import { NextResponse } from 'next/server';
import { dbAdapter, Account } from '@/lib/db';

// GET all accounts
export async function GET() {
  try {
    const accounts = await dbAdapter.getAccounts();
    return NextResponse.json({ accounts });
  } catch (error: any) {
    console.error('Error fetching accounts:', error);
    return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
  }
}

// POST create manual account
export async function POST(request: Request) {
  try {
    const { name, type, subtype, balance, institutionName } = await request.json();

    if (!name || !type || !subtype || balance === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const newAccount: Account = {
      id: 'manual_' + Math.random().toString(36).substr(2, 9),
      name,
      mask: null,
      type,
      subtype,
      balance: parseFloat(balance),
      institutionName: institutionName || 'Manual Asset',
      isManual: true,
      lastSync: new Date().toISOString(),
    };

    await dbAdapter.saveAccount(newAccount);
    return NextResponse.json({ success: true, account: newAccount });
  } catch (error: any) {
    console.error('Error creating manual account:', error);
    return NextResponse.json({ error: 'Failed to create manual account' }, { status: 500 });
  }
}

// DELETE an account or unlink an institution
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');

    if (!accountId) {
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
    }

    const accounts = await dbAdapter.getAccounts();
    const account = accounts.find((a) => a.id === accountId);

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    if (account.isManual) {
      // For manual accounts, just delete this single account
      await dbAdapter.deleteAccount(accountId);
      return NextResponse.json({ success: true, message: 'Manual account deleted successfully.' });
    } else {
      // For automated accounts, unlink the entire connection (Plaid Item)
      const itemId = account.itemId;
      if (itemId) {
        await dbAdapter.deletePlaidItem(itemId);
        return NextResponse.json({
          success: true,
          message: 'Plaid institution and all associated accounts unlinked successfully.',
        });
      } else {
        await dbAdapter.deleteAccount(accountId);
        return NextResponse.json({ success: true, message: 'Account deleted.' });
      }
    }
  } catch (error: any) {
    console.error('Error deleting account:', error);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}

