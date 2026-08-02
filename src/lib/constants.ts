export const STANDARD_CATEGORIES = [
  'Income & Payroll',
  'Housing & Rent',
  'Food & Drink',
  'Shopping',
  'Travel & Transport',
  'Utilities & Bills',
  'Investments',
  'Transfer',
  'Other'
];

export const CATEGORY_SUBCATEGORIES: Record<string, string[]> = {
  'Food & Drink': ['Cafe', 'Grocery', 'Dining Out', 'Delivery', 'Other Food'],
  'Shopping': ['Retail', 'Electronics', 'Books & Media', 'Clothing', 'Other Shop'],
  'Utilities & Bills': ['Subscriptions', 'Phone & Internet', 'Utilities', 'Fees', 'Other Bills'],
  'Travel & Transport': ['Rideshare', 'Gas & Fuel', 'Transit & Flights', 'Other Travel'],
  'Housing & Rent': ['Rent', 'Maintenance', 'Other Housing'],
  'Investments': ['Retirement', 'Brokerage', 'Other Invest'],
  'Income & Payroll': ['Salary', 'Reimbursement', 'Gifts & Bonus', 'Other Income'],
  'Transfer': ['Credit Card Payment', 'Savings Transfer', 'Other Transfer'],
  'Other': ['Uncategorized']
};
