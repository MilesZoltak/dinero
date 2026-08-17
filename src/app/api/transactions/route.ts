import { NextResponse } from 'next/server';
import { dbAdapter, Transaction } from '@/lib/db';
import { categorizeTransaction, seedDefaultRules, categorizeSubcategory } from '@/lib/categorizer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// GET all transactions
export async function GET() {
  try {
    const transactions = await dbAdapter.getTransactions();
    return NextResponse.json({ transactions });
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json({ error: error?.message || 'Failed to fetch transactions' }, { status: 500 });
  }
}

// POST one or more transactions (for manual entries or CSV batch uploads)
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Ensure categorization rules are ready
    await seedDefaultRules();
    const rules = await dbAdapter.getCategoryRules();

    // Check if it is a batch import (array)
    if (Array.isArray(body.transactions)) {
      const txsToSave: Transaction[] = body.transactions.map((tx: any) => {
        const finalCategory = tx.category && tx.category !== 'Other' && tx.category !== 'Uncategorized'
          ? tx.category 
          : categorizeTransaction(tx.name, rules);
        const finalSubcategory = categorizeSubcategory(tx.name, finalCategory);

        return {
          id: tx.id || 'tx_manual_' + Math.random().toString(36).substr(2, 9),
          accountId: tx.accountId,
          amount: parseFloat(tx.amount),
          date: tx.date || new Date().toISOString().split('T')[0],
          name: tx.name,
          category: finalCategory,
          subcategory: finalSubcategory,
          isPending: false,
          isManual: true,
        };
      });

      if (txsToSave.some((tx) => !tx.accountId || isNaN(tx.amount) || !tx.name)) {
        return NextResponse.json({ error: 'Invalid transaction structure in batch' }, { status: 400 });
      }

      await dbAdapter.saveTransactions(txsToSave);
      return NextResponse.json({ success: true, count: txsToSave.length });
    }

    // Single transaction insert
    const { accountId, amount, date, name, category } = body;

    if (!accountId || amount === undefined || !name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const finalCategory = category && category !== 'Other' && category !== 'Uncategorized'
      ? category 
      : categorizeTransaction(name, rules);
    const finalSubcategory = categorizeSubcategory(name, finalCategory);

    const newTx: Transaction = {
      id: 'tx_manual_' + Math.random().toString(36).substr(2, 9),
      accountId,
      amount: parseFloat(amount),
      date: date || new Date().toISOString().split('T')[0],
      name,
      category: finalCategory,
      subcategory: finalSubcategory,
      isPending: false,
      isManual: true,
    };

    await dbAdapter.saveTransaction(newTx);
    return NextResponse.json({ success: true, transaction: newTx });
  } catch (error: any) {
    console.error('Error adding transaction(s):', error);
    return NextResponse.json({ error: 'Failed to add transactions' }, { status: 500 });
  }
}

// PATCH to update the category of a batch of existing transactions
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { updates } = body; // Array<{ id: string, category: string }>

    if (!Array.isArray(updates)) {
      return NextResponse.json({ error: 'Updates must be an array' }, { status: 400 });
    }

    const allTransactions = await dbAdapter.getTransactions();
    const updatedTxs: Transaction[] = [];

    for (const update of updates) {
      const match = allTransactions.find((t) => t.id === update.id);
      if (match) {
        // If only subcategory is changing (no category update), preserve existing category
        const finalCategory = update.category || match.category;
        // If subcategory is explicitly provided, use it; otherwise auto-derive from category
        const finalSubcategory = update.subcategory !== undefined
          ? update.subcategory
          : categorizeSubcategory(match.name, finalCategory);
        updatedTxs.push({
          ...match,
          category: finalCategory,
          subcategory: finalSubcategory
        });
      }
    }

    if (updatedTxs.length > 0) {
      await dbAdapter.saveTransactions(updatedTxs);
    }

    return NextResponse.json({ success: true, count: updatedTxs.length });
  } catch (error: any) {
    console.error('Error updating transactions in batch:', error);
    return NextResponse.json({ error: 'Failed to update transactions' }, { status: 500 });
  }
}

// DELETE a manual transaction
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const txId = searchParams.get('txId');

    if (!txId) {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
    }

    await dbAdapter.deleteTransaction(txId);
    return NextResponse.json({ success: true, message: 'Transaction deleted successfully.' });
  } catch (error: any) {
    console.error('Error deleting transaction:', error);
    return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 });
  }
}
