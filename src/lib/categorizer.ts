import { dbAdapter, CategoryRule, Transaction } from './db';
import { STANDARD_CATEGORIES } from './constants';

// Seed rules list to pre-populate database for instant utility
const DEFAULT_RULE_SEEDS = [
  { pattern: 'payment thank you', category: 'Transfer' },
  { pattern: 'thank you', category: 'Transfer' },
  { pattern: 'returned payment', category: 'Transfer' },
  { pattern: 'contribution', category: 'Transfer' },
  { pattern: 'chase credit crd', category: 'Transfer' },
  { pattern: 'credit card payment', category: 'Transfer' },
  { pattern: 'credit crd', category: 'Transfer' },
  { pattern: 'rocket savings', category: 'Transfer' },
  { pattern: 'keep the change', category: 'Transfer' },
  { pattern: 'keepthechange', category: 'Transfer' },
  { pattern: 'transfer', category: 'Transfer' },
  { pattern: 'payroll', category: 'Income & Payroll' },
  { pattern: 'salary', category: 'Income & Payroll' },
  { pattern: 'direct deposit', category: 'Income & Payroll' },
  { pattern: 'rent payment', category: 'Housing & Rent' },
  { pattern: 'mortgage', category: 'Housing & Rent' },
  { pattern: 'starbucks', category: 'Food & Drink' },
  { pattern: 'whole foods', category: 'Food & Drink' },
  { pattern: 'trader joe', category: 'Food & Drink' },
  { pattern: 'safeway', category: 'Food & Drink' },
  { pattern: 'h mart', category: 'Food & Drink' },
  { pattern: 'cafe', category: 'Food & Drink' },
  { pattern: 'coffee', category: 'Food & Drink' },
  { pattern: 'restaurant', category: 'Food & Drink' },
  { pattern: 'teriyaki', category: 'Food & Drink' },
  { pattern: 'doordash', category: 'Food & Drink' },
  { pattern: 'uber', category: 'Travel & Transport' },
  { pattern: 'lyft', category: 'Travel & Transport' },
  { pattern: 'chevron', category: 'Travel & Transport' },
  { pattern: 'shell', category: 'Travel & Transport' },
  { pattern: 'orca', category: 'Travel & Transport' },
  { pattern: 'goodtogo', category: 'Travel & Transport' },
  { pattern: 'wsdot', category: 'Travel & Transport' },
  { pattern: 'amazon', category: 'Shopping' },
  { pattern: 'target', category: 'Shopping' },
  { pattern: 'netflix', category: 'Utilities & Bills' },
  { pattern: 'spotify', category: 'Utilities & Bills' },
  { pattern: 'comcast', category: 'Utilities & Bills' },
  { pattern: 'schwab', category: 'Investments' },
  { pattern: 'fidelity', category: 'Investments' },
  { pattern: 'vanguard', category: 'Investments' },
  { pattern: 'therapy', category: 'Utilities & Bills' }, // healthcare/wellness -> bills
  { pattern: 'venmo', category: 'Other' }
];

// Helper to seed default rules if none exist in the database
export async function seedDefaultRules() {
  try {
    const existingRules = await dbAdapter.getCategoryRules();
    const existingPatterns = new Set(existingRules.map(r => r.pattern.toLowerCase()));

    for (const seed of DEFAULT_RULE_SEEDS) {
      if (!existingPatterns.has(seed.pattern.toLowerCase())) {
        const ruleId = 'rule_' + Math.random().toString(36).substr(2, 9);
        await dbAdapter.saveCategoryRule({
          id: ruleId,
          pattern: seed.pattern,
          category: seed.category
        });
      }
    }
  } catch (error) {
    console.error('Failed to seed default category rules:', error);
  }
}

// Matching function: check transaction description against active rules list
export function categorizeTransaction(name: string, rules: CategoryRule[]): string {
  const normalizedName = name.toLowerCase();
  
  // Find first rule where pattern is a substring of the transaction name
  const matchedRule = rules.find(rule => 
    normalizedName.includes(rule.pattern.toLowerCase())
  );

  return matchedRule ? matchedRule.category : 'Other';
}

// Check if any rule has an explicit subcategory override for this transaction
export function applySubcategoryRule(name: string, category: string, rules: CategoryRule[]): string | null {
  const normalizedName = name.toLowerCase();
  // Look for rules that match the name AND have a subcategory set for the given category
  const matchedRule = rules.find(rule =>
    rule.subcategory &&
    rule.category === category &&
    normalizedName.includes(rule.pattern.toLowerCase())
  );
  return matchedRule?.subcategory ?? null;
}

// Retroactive runner: re-classifies existing transactions against updated rules
export async function retroactivelyCategorizeTransactions(): Promise<number> {
  // Ensure default rules are seeded first if empty
  await seedDefaultRules();

  const rules = await dbAdapter.getCategoryRules();
  const transactions = await dbAdapter.getTransactions();
  const updatedTransactions: Transaction[] = [];

  for (const tx of transactions) {
    const currentCategory = tx.category;
    const currentSub = tx.subcategory;
    
    const newCategory = categorizeTransaction(tx.name, rules);
    const newSub = categorizeSubcategory(tx.name, newCategory);

    if (currentCategory !== newCategory || currentSub !== newSub) {
      updatedTransactions.push({
        ...tx,
        category: newCategory,
        subcategory: newSub
      });
    }
  }

  if (updatedTransactions.length > 0) {
    await dbAdapter.saveTransactions(updatedTransactions);
  }

  return updatedTransactions.length;
}

/**
 * Maps a transaction description and high-level category to a valid standard subcategory.
 */
export function categorizeSubcategory(name: string, category: string): string {
  const upper = name.toUpperCase();

  switch (category) {
    case 'Food & Drink':
      if (upper.includes('STARBUCKS') || upper.includes('CAFE') || upper.includes('COFFEE') || upper.includes('BAGEL') || upper.includes('EPICUREAN') || upper.includes('AN?CLAIR')) return 'Cafe';
      if (upper.includes('WHOLEFDS') || upper.includes('WHOLE FOOD') || upper.includes('TRADER JOE') || upper.includes('SAFEWAY') || upper.includes('H MART') || upper.includes('GROCERY') || upper.includes('QFC') || upper.includes('MARKET')) return 'Grocery';
      if (upper.includes('DOORDASH') || upper.includes('DELIVERY') || upper.includes('EATS') || upper.includes('GRUBHUB')) return 'Delivery';
        return '' ; // default no subcategory when no pattern matches

    case 'Shopping':
      if (upper.includes('AMAZON') || upper.includes('TARGET') || upper.includes('WALMART') || upper.includes('RETAIL')) return 'Retail';
      if (upper.includes('STEAM') || upper.includes('PLAYSTATION') || upper.includes('NINTENDO') || upper.includes('GAME') || upper.includes('ELECTRONICS') || upper.includes('APPLE')) return 'Electronics';
      if (upper.includes('BOOK') || upper.includes('LIBRARY') || upper.includes('AUDIBLE')) return 'Books & Media';
      if (upper.includes('CLOTHING') || upper.includes('GAP') || upper.includes('ZARA') || upper.includes('NORDSTROM')) return 'Clothing';
      return 'Other Shop';

    case 'Utilities & Bills':
      if (upper.includes('NETFLIX') || upper.includes('SPOTIFY') || upper.includes('YOUTUBE') || upper.includes('SUBSCRIBE') || upper.includes('IPHONE') || upper.includes('APPLE.COM')) return 'Subscriptions';
      if (upper.includes('MOBILE') || upper.includes('VERIZON') || upper.includes('AT&T') || upper.includes('INTERNET') || upper.includes('COMCAST')) return 'Phone & Internet';
      if (upper.includes('FEE') || upper.includes('MAINTENANCE') || upper.includes('INTEREST')) return 'Fees';
      return 'Utilities';

    case 'Travel & Transport':
      if (upper.includes('UBER') || upper.includes('LYFT') || upper.includes('TAXI') || upper.includes('RIDESHARE')) return 'Rideshare';
      if (upper.includes('SHELL') || upper.includes('CHEVRON') || upper.includes('GAS') || upper.includes('FUEL') || upper.includes('EXXON')) return 'Gas & Fuel';
      if (upper.includes('FLIGHT') || upper.includes('AIRLINE') || upper.includes('DELTA') || upper.includes('UNITED') || upper.includes('TRAIN') || upper.includes('AMTRAK') || upper.includes('TRAVEL')) return 'Transit & Flights';
      return 'Other Travel';

    case 'Housing & Rent':
      if (upper.includes('RENT') || upper.includes('MORTGAGE')) return 'Rent';
      if (upper.includes('MAINTENANCE') || upper.includes('REPAIR') || upper.includes('HARDWARE')) return 'Maintenance';
      return 'Other Housing';

    case 'Investments':
      if (upper.includes('401K') || upper.includes('401(K)') || upper.includes('IRA') || upper.includes('RETIREMENT') || upper.includes('FIDELITY') || upper.includes('CONTRIBUTION')) return 'Retirement';
      if (upper.includes('SCHWAB') || upper.includes('BROKERAGE') || upper.includes('STOCK')) return 'Brokerage';
      return 'Other Invest';

    case 'Income & Payroll':
      if (upper.includes('PAYROLL') || upper.includes('SALARY') || upper.includes('AUGER') || upper.includes('DIRECT DEPOSIT')) return 'Salary';
      if (upper.includes('REIMBURSE') || upper.includes('EXPENSE')) return 'Reimbursement';
      if (upper.includes('GIFT') || upper.includes('BONUS')) return 'Gifts & Bonus';
      return 'Other Income';

    case 'Transfer':
      if (upper.includes('CHASE CREDIT') || upper.includes('CREDIT CRD') || upper.includes('EPAY') || upper.includes('EPAYMENT') || upper.includes('Returned Payment')) return 'Credit Card Payment';
      if (upper.includes('SAVINGS') || upper.includes('ROCKET') || upper.includes('Marcus') || upper.includes('SFCU')) return 'Savings Transfer';
      return 'Other Transfer';

    default:
      return 'Uncategorized';
  }
}
