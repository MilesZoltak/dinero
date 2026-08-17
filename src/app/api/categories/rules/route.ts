import { NextResponse } from 'next/server';
import { dbAdapter, CategoryRule } from '@/lib/db';
import { seedDefaultRules } from '@/lib/categorizer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// GET all rules
export async function GET() {
  try {
    await seedDefaultRules();
    const rules = await dbAdapter.getCategoryRules();
    return NextResponse.json({ rules });
  } catch (error: any) {
    console.error('Error fetching category rules:', error);
    return NextResponse.json({ error: 'Failed to fetch rules' }, { status: 500 });
  }
}

// POST create a rule
export async function POST(request: Request) {
  try {
    const { pattern, category, subcategory } = await request.json();

    if (!pattern || !category) {
      return NextResponse.json({ error: 'Pattern and Category are required' }, { status: 400 });
    }

    const ruleId = 'rule_' + Math.random().toString(36).substr(2, 9);
    const newRule: CategoryRule = {
      id: ruleId,
      pattern: pattern.trim().toLowerCase(),
      category,
      ...(subcategory ? { subcategory } : {})
    };

    await dbAdapter.saveCategoryRule(newRule);
    return NextResponse.json({ success: true, rule: newRule });
  } catch (error: any) {
    console.error('Error saving category rule:', error);
    return NextResponse.json({ error: 'Failed to save rule' }, { status: 500 });
  }
}

// DELETE a rule
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ruleId = searchParams.get('ruleId');

    if (!ruleId) {
      return NextResponse.json({ error: 'Rule ID is required' }, { status: 400 });
    }

    await dbAdapter.deleteCategoryRule(ruleId);
    return NextResponse.json({ success: true, message: 'Category rule deleted successfully.' });
  } catch (error: any) {
    console.error('Error deleting category rule:', error);
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  }
}
