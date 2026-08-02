import { NextResponse } from 'next/server';
import { retroactivelyCategorizeTransactions } from '@/lib/categorizer';

// POST to trigger retroactive classification sweep over database
export async function POST() {
  try {
    const updatedCount = await retroactivelyCategorizeTransactions();
    return NextResponse.json({ 
      success: true, 
      message: `Retroactive categorization completed. Updated ${updatedCount} transaction(s).`,
      count: updatedCount
    });
  } catch (error: any) {
    console.error('Error running retroactive categorization:', error);
    return NextResponse.json({ error: 'Failed to execute retroactive categorization' }, { status: 500 });
  }
}
