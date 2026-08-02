/**
 * Normalizes raw transaction payee descriptions into clean, readable business names.
 * e.g. "WHOLEFDS BLV 10153" -> "Whole Foods"
 *      "SQ *CAFE AN?CLAIR" -> "Cafe Anclair"
 */
export function cleanMerchantName(rawName: string): string {
  if (!rawName) return 'Unknown Business';

  let cleaned = rawName;

  // 1. Remove common payment gateway / protocol prefixes
  cleaned = cleaned.replace(/^(SQ\s*\*|TST\s*\*|DD\s*\*|CTLP\s*\*|ACH\s+Debit\s+|ACH\s+Credit\s+|Payment\s+Thank\s+You[- ]?|Deposit\s+Online\s+Transfer\s+from\s+|Mobile\s+Deposit\s+-[ ]?|POS\s+Pre\s+Auth\s*)/gi, '');

  // 2. Normalize casing to make matching easier
  const upper = cleaned.toUpperCase();

  // 3. Match known major brands to give beautiful readable names
  if (upper.includes('STARBUCKS')) return 'Starbucks';
  if (upper.includes('WHOLE FOOD') || upper.includes('WHOLEFDS')) return 'Whole Foods';
  if (upper.includes('TRADER JOE')) return "Trader Joe's";
  if (upper.includes('DOORDASH')) return 'DoorDash';
  if (upper.includes('UBER')) return 'Uber';
  if (upper.includes('SHELL OIL') || upper.includes('SHELL')) return 'Shell Gas';
  if (upper.includes('CHASE CREDIT') || upper.includes('CHASE CRD')) return 'Chase Credit Card';
  if (upper.includes('VENMO')) return 'Venmo';
  if (upper.includes('SEAVIEW')) return 'Seaview';
  if (upper.includes('TACOS COMETA')) return 'Tacos Cometa';
  if (upper.includes('BELLE EPICUREAN')) return 'Belle Epicurean';
  if (upper.includes('ROCKET SAVINGS') || upper.includes('ROCKETSAVINGS')) return 'Rocket Savings';
  if (upper.includes('Fidelity') || upper.includes('AUGER 401')) return 'Fidelity Investments';

  // 4. If not a known brand, apply general cleanup rules
  // Strip store numbers / hashes / terminal numbers / tail codes (e.g. Starbucks #1234 -> Starbucks)
  cleaned = cleaned.replace(/\s+#?\d+.*$/g, ''); // strip tail digits
  cleaned = cleaned.replace(/\b(BLV|ST|AVE|RD|DR|WAY|LN|COURT|PLAZA|STE|SUITE)\b.*$/gi, ''); // strip tail addresses
  cleaned = cleaned.replace(/[\- ]EPAY.*$/gi, ''); // strip EPAY suffixes
  cleaned = cleaned.replace(/[\- ]PAYMENT.*$/gi, ''); // strip PAYMENT suffixes

  cleaned = cleaned.trim();

  // Capitalize words nicely
  return cleaned
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || rawName;
}
