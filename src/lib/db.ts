import fs from 'fs';
import path from 'path';
import { db as firestoreDb } from './firebaseAdmin';

export interface Account {
  id: string;
  name: string;
  mask: string | null;
  type: string; // 'depository', 'credit', 'investment', 'loan', 'other'
  subtype: string; // 'checking', 'savings', 'credit card', 'brokerage', '401k', 'hsa', etc.
  balance: number;
  limit?: number | null;
  institutionName: string;
  isManual: boolean;
  itemId?: string | null; // Can hold Plaid Item ID or SimpleFIN Connection ID
  lastSync?: string | null;
}

export interface Transaction {
  id: string;
  accountId: string;
  amount: number; // positive = debit/expense, negative = credit/income
  date: string; // YYYY-MM-DD
  name: string;
  category: string;
  subcategory?: string;
  isPending: boolean;
  isManual: boolean;
}

export interface PlaidItem {
  itemId: string;
  accessToken: string;
  institutionId: string;
  institutionName: string;
}

export interface SimpleFinConnection {
  id: string;
  accessUrl: string;
  orgName: string;
}

export interface CategoryRule {
  id: string;
  pattern: string;
  category: string;
  subcategory?: string; // if set, only the subcategory is overridden (category must also match)
}

interface LocalDatabase {
  accounts: Account[];
  transactions: Transaction[];
  plaidItems: PlaidItem[];
  simpleFinConnections: SimpleFinConnection[];
  categoryRules: CategoryRule[];
}

const LOCAL_DB_DIR = path.join(process.cwd(), 'data');
const LOCAL_DB_PATH = path.join(LOCAL_DB_DIR, 'db.json');

// Helper to check if Firestore is configured and available
function isFirestoreEnabled(): boolean {
  return firestoreDb !== null;
}

// Helper to initialize local DB file if it doesn't exist
function initLocalDb() {
  if (!fs.existsSync(LOCAL_DB_DIR)) {
    fs.mkdirSync(LOCAL_DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    fs.writeFileSync(
      LOCAL_DB_PATH,
      JSON.stringify({ accounts: [], transactions: [], plaidItems: [], simpleFinConnections: [], categoryRules: [] }, null, 2)
    );
  }
}

// Read local DB
function readLocalDb(): LocalDatabase {
  initLocalDb();
  try {
    const data = fs.readFileSync(LOCAL_DB_PATH, 'utf8');
    const parsed = JSON.parse(data);
    return {
      accounts: parsed.accounts || [],
      transactions: parsed.transactions || [],
      plaidItems: parsed.plaidItems || [],
      simpleFinConnections: parsed.simpleFinConnections || [],
      categoryRules: parsed.categoryRules || [],
    };
  } catch (error) {
    console.error('Error reading local db.json, resetting database:', error);
    return { accounts: [], transactions: [], plaidItems: [], simpleFinConnections: [], categoryRules: [] };
  }
}

// Write local DB
function writeLocalDb(data: LocalDatabase) {
  initLocalDb();
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(data, null, 2));
}

// Database methods mapping to Firestore or local DB
export const dbAdapter = {
  // --- Accounts ---
  async getAccounts(): Promise<Account[]> {
    if (isFirestoreEnabled()) {
      try {
        const snapshot = await firestoreDb!.collection('accounts').get();
        return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Account));
      } catch (error) {
        console.error('Firestore failed to get accounts, falling back to local database:', error);
      }
    }
    return readLocalDb().accounts;
  },

  async saveAccount(account: Account): Promise<void> {
    if (isFirestoreEnabled()) {
      try {
        await firestoreDb!.collection('accounts').doc(account.id).set(account);
        return;
      } catch (error) {
        console.error('Firestore failed to save account, falling back to local database:', error);
      }
    }
    const local = readLocalDb();
    const index = local.accounts.findIndex((a) => a.id === account.id);
    if (index >= 0) {
      local.accounts[index] = account;
    } else {
      local.accounts.push(account);
    }
    writeLocalDb(local);
  },

  async deleteAccount(accountId: string): Promise<void> {
    if (isFirestoreEnabled()) {
      try {
        await firestoreDb!.collection('accounts').doc(accountId).delete();
        const txsSnapshot = await firestoreDb!.collection('transactions').where('accountId', '==', accountId).get();
        const batch = firestoreDb!.batch();
        txsSnapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
        await batch.commit();
        return;
      } catch (error) {
        console.error('Firestore failed to delete account, falling back to local database:', error);
      }
    }
    const local = readLocalDb();
    local.accounts = local.accounts.filter((a) => a.id !== accountId);
    local.transactions = local.transactions.filter((t) => t.accountId !== accountId);
    writeLocalDb(local);
  },

  // --- Transactions ---
  async getTransactions(): Promise<Transaction[]> {
    if (isFirestoreEnabled()) {
      try {
        const snapshot = await firestoreDb!.collection('transactions').orderBy('date', 'desc').get();
        return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Transaction));
      } catch (error) {
        console.error('Firestore failed to get transactions, falling back to local database:', error);
      }
    }
    const txs = readLocalDb().transactions;
    return txs.sort((a, b) => b.date.localeCompare(a.date));
  },

  async saveTransactions(transactions: Transaction[]): Promise<void> {
    if (isFirestoreEnabled()) {
      try {
        const batch = firestoreDb!.batch();
        transactions.forEach((tx) => {
          const docRef = firestoreDb!.collection('transactions').doc(tx.id);
          batch.set(docRef, tx);
        });
        await batch.commit();
        return;
      } catch (error) {
        console.error('Firestore failed to save transactions, falling back to local database:', error);
      }
    }
    const local = readLocalDb();
    transactions.forEach((newTx) => {
      const index = local.transactions.findIndex((t) => t.id === newTx.id);
      if (index >= 0) {
        local.transactions[index] = newTx;
      } else {
        local.transactions.push(newTx);
      }
    });
    writeLocalDb(local);
  },

  async saveTransaction(tx: Transaction): Promise<void> {
    return this.saveTransactions([tx]);
  },

  async deleteTransaction(txId: string): Promise<void> {
    if (isFirestoreEnabled()) {
      try {
        await firestoreDb!.collection('transactions').doc(txId).delete();
        return;
      } catch (error) {
        console.error('Firestore failed to delete transaction, falling back to local database:', error);
      }
    }
    const local = readLocalDb();
    local.transactions = local.transactions.filter((t) => t.id !== txId);
    writeLocalDb(local);
  },

  // --- Plaid Items (Access Tokens) ---
  async getPlaidItems(): Promise<PlaidItem[]> {
    if (isFirestoreEnabled()) {
      try {
        const snapshot = await firestoreDb!.collection('plaidItems').get();
        return snapshot.docs.map((doc: any) => ({ itemId: doc.id, ...doc.data() } as PlaidItem));
      } catch (error) {
        console.error('Firestore failed to get Plaid items, falling back to local database:', error);
      }
    }
    return readLocalDb().plaidItems;
  },

  async savePlaidItem(item: PlaidItem): Promise<void> {
    if (isFirestoreEnabled()) {
      try {
        await firestoreDb!.collection('plaidItems').doc(item.itemId).set(item);
        return;
      } catch (error) {
        console.error('Firestore failed to save Plaid item, falling back to local database:', error);
      }
    }
    const local = readLocalDb();
    const index = local.plaidItems.findIndex((i) => i.itemId === item.itemId);
    if (index >= 0) {
      local.plaidItems[index] = item;
    } else {
      local.plaidItems.push(item);
    }
    writeLocalDb(local);
  },

  async deletePlaidItem(itemId: string): Promise<void> {
    if (isFirestoreEnabled()) {
      try {
        await firestoreDb!.collection('plaidItems').doc(itemId).delete();
        const accountsSnapshot = await firestoreDb!.collection('accounts').where('itemId', '==', itemId).get();
        const batch = firestoreDb!.batch();
        for (const doc of accountsSnapshot.docs) {
          batch.delete(doc.ref);
          const txsSnapshot = await firestoreDb!.collection('transactions').where('accountId', '==', doc.id).get();
          txsSnapshot.docs.forEach((tDoc: any) => batch.delete(tDoc.ref));
        }
        await batch.commit();
        return;
      } catch (error) {
        console.error('Firestore failed to delete Plaid item, falling back to local database:', error);
      }
    }
    const local = readLocalDb();
    const accountsToDelete = local.accounts.filter((a) => a.itemId === itemId).map((a) => a.id);
    local.plaidItems = local.plaidItems.filter((i) => i.itemId !== itemId);
    local.accounts = local.accounts.filter((a) => a.itemId !== itemId);
    local.transactions = local.transactions.filter((t) => !accountsToDelete.includes(t.accountId));
    writeLocalDb(local);
  },

  // --- SimpleFIN Connections ---
  async getSimpleFinConnections(): Promise<SimpleFinConnection[]> {
    if (isFirestoreEnabled()) {
      try {
        const snapshot = await firestoreDb!.collection('simpleFinConnections').get();
        return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as SimpleFinConnection));
      } catch (error) {
        console.error('Firestore failed to get SimpleFIN connections, falling back to local database:', error);
      }
    }
    return readLocalDb().simpleFinConnections;
  },

  async saveSimpleFinConnection(conn: SimpleFinConnection): Promise<void> {
    if (isFirestoreEnabled()) {
      try {
        await firestoreDb!.collection('simpleFinConnections').doc(conn.id).set(conn);
        return;
      } catch (error) {
        console.error('Firestore failed to save SimpleFIN connection, falling back to local database:', error);
      }
    }
    const local = readLocalDb();
    const index = local.simpleFinConnections.findIndex((c) => c.id === conn.id);
    if (index >= 0) {
      local.simpleFinConnections[index] = conn;
    } else {
      local.simpleFinConnections.push(conn);
    }
    writeLocalDb(local);
  },

  async deleteSimpleFinConnection(id: string): Promise<void> {
    if (isFirestoreEnabled()) {
      try {
        await firestoreDb!.collection('simpleFinConnections').doc(id).delete();
        const accountsSnapshot = await firestoreDb!.collection('accounts').where('itemId', '==', id).get();
        const batch = firestoreDb!.batch();
        for (const doc of accountsSnapshot.docs) {
          batch.delete(doc.ref);
          const txsSnapshot = await firestoreDb!.collection('transactions').where('accountId', '==', doc.id).get();
          txsSnapshot.docs.forEach((tDoc: any) => batch.delete(tDoc.ref));
        }
        await batch.commit();
        return;
      } catch (error) {
        console.error('Firestore failed to delete SimpleFIN connection, falling back to local database:', error);
      }
    }
    const local = readLocalDb();
    const accountsToDelete = local.accounts.filter((a) => a.itemId === id).map((a) => a.id);
    local.simpleFinConnections = local.simpleFinConnections.filter((c) => c.id !== id);
    local.accounts = local.accounts.filter((a) => a.itemId !== id);
    local.transactions = local.transactions.filter((t) => !accountsToDelete.includes(t.accountId));
    writeLocalDb(local);
  },

  // --- Category Rules ---
  async getCategoryRules(): Promise<CategoryRule[]> {
    if (isFirestoreEnabled()) {
      try {
        const snapshot = await firestoreDb!.collection('categoryRules').get();
        return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as CategoryRule));
      } catch (error) {
        console.error('Firestore failed to get category rules, falling back to local database:', error);
      }
    }
    return readLocalDb().categoryRules;
  },

  async saveCategoryRule(rule: CategoryRule): Promise<void> {
    if (isFirestoreEnabled()) {
      try {
        await firestoreDb!.collection('categoryRules').doc(rule.id).set(rule);
        return;
      } catch (error) {
        console.error('Firestore failed to save category rule, falling back to local database:', error);
      }
    }
    const local = readLocalDb();
    const index = local.categoryRules.findIndex((r) => r.id === rule.id);
    if (index >= 0) {
      local.categoryRules[index] = rule;
    } else {
      local.categoryRules.push(rule);
    }
    writeLocalDb(local);
  },

  async deleteCategoryRule(id: string): Promise<void> {
    if (isFirestoreEnabled()) {
      try {
        await firestoreDb!.collection('categoryRules').doc(id).delete();
        return;
      } catch (error) {
        console.error('Firestore failed to delete category rule, falling back to local database:', error);
      }
    }
    const local = readLocalDb();
    local.categoryRules = local.categoryRules.filter((r) => r.id !== id);
    writeLocalDb(local);
  }
};
