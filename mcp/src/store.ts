import { Firestore } from "@google-cloud/firestore";

/** Plain read-only views. Only these fields ever leave the service. */
export interface Account {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string;
  balance: number;
  limit: number | null;
  institutionName: string;
  isManual: boolean;
  lastSync: string | null;
}

/** Convention: positive amount is an expense, negative is income. */
export interface Transaction {
  id: string;
  accountId: string;
  amount: number;
  date: string; // YYYY-MM-DD
  name: string;
  category: string;
  subcategory: string | null;
  isPending: boolean;
}

export interface TransactionFilter {
  startDate?: string;
  endDate?: string;
}

export interface Store {
  getAccounts(): Promise<Account[]>;
  getTransactions(filter: TransactionFilter): Promise<Transaction[]>;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Explicit field whitelist. Documents are never spread, so a stray field
 * (for example an access token) cannot reach a tool response.
 */
export function toAccount(id: string, d: Record<string, unknown>): Account {
  return {
    id,
    name: str(d.name),
    mask: typeof d.mask === "string" ? d.mask : null,
    type: str(d.type, "other"),
    subtype: str(d.subtype),
    balance: num(d.balance),
    limit: typeof d.limit === "number" ? d.limit : null,
    institutionName: str(d.institutionName),
    isManual: d.isManual === true,
    lastSync: typeof d.lastSync === "string" ? d.lastSync : null,
  };
}

export function toTransaction(id: string, d: Record<string, unknown>): Transaction {
  return {
    id,
    accountId: str(d.accountId),
    amount: num(d.amount),
    date: str(d.date),
    name: str(d.name),
    category: str(d.category, "Uncategorized") || "Uncategorized",
    subcategory: typeof d.subcategory === "string" && d.subcategory ? d.subcategory : null,
    isPending: d.isPending === true,
  };
}

export function createFirestoreStore(projectId?: string): Store {
  const db = new Firestore({ projectId, ignoreUndefinedProperties: true });
  return {
    async getAccounts() {
      const snap = await db.collection("accounts").get();
      return snap.docs.map((doc) => toAccount(doc.id, doc.data()));
    },
    async getTransactions({ startDate, endDate }) {
      // A range filter plus orderBy on the same field needs no composite index.
      let q = db.collection("transactions").orderBy("date", "desc");
      if (startDate) q = q.where("date", ">=", startDate);
      if (endDate) q = q.where("date", "<=", endDate);
      const snap = await q.get();
      return snap.docs.map((doc) => toTransaction(doc.id, doc.data()));
    },
  };
}
