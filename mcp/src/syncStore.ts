import { Firestore } from "@google-cloud/firestore";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import type { ItemRecord, PlaidLike, SyncStore } from "./sync.ts";
import type { LinkPlaidLike, LinkStore } from "./link.ts";
import type { CategoryRule } from "./categorize.ts";
import type { CategoryStore, CategorizeRow } from "./recategorize.ts";
import type { CategoryWriteStore } from "./categoryWrites.ts";

const BATCH = 400; // Firestore allows 500 writes per batch

function chunks<T>(xs: T[], n = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function createFirestoreSyncStore(projectId?: string): SyncStore {
  const db = new Firestore({ projectId, ignoreUndefinedProperties: true });
  return {
    async getPlaidItems() {
      const snap = await db.collection("plaidItems").get();
      return snap.docs.map((d): ItemRecord => {
        const x = d.data();
        return {
          itemId: d.id,
          accessToken: typeof x.accessToken === "string" ? x.accessToken : "",
          institutionName: typeof x.institutionName === "string" ? x.institutionName : "",
          syncCursor: typeof x.syncCursor === "string" ? x.syncCursor : undefined,
        };
      });
    },
    async upsertAccounts(accounts) {
      for (const part of chunks(accounts)) {
        const batch = db.batch();
        for (const a of part) batch.set(db.collection("accounts").doc(a.id), a, { merge: true });
        await batch.commit();
      }
    },
    async upsertTransactions(txs) {
      for (const part of chunks(txs)) {
        const batch = db.batch();
        for (const t of part) batch.set(db.collection("transactions").doc(t.id), t, { merge: true });
        await batch.commit();
      }
    },
    async deleteTransactions(ids) {
      for (const part of chunks(ids)) {
        const batch = db.batch();
        for (const id of part) batch.delete(db.collection("transactions").doc(id));
        await batch.commit();
      }
    },
    async getCategoryRules() {
      return readRules(db);
    },
    async existingCategorizedIds(ids) {
      const found = new Set<string>();
      for (const part of chunks(ids, 300)) {
        if (!part.length) continue;
        const refs = part.map((id) => db.collection("transactions").doc(id));
        const docs = await db.getAll(...refs, { fieldMask: ["category"] });
        for (const d of docs) if (d.exists && d.get("category")) found.add(d.id);
      }
      return found;
    },
    async manualCategories(ids) {
      const found = new Map<string, { category: string; subcategory: string | null }>();
      for (const part of chunks(ids, 300)) {
        if (!part.length) continue;
        const refs = part.map((id) => db.collection("transactions").doc(id));
        const docs = await db.getAll(...refs, { fieldMask: ["category", "subcategory", "categorySource"] });
        for (const d of docs) {
          if (!d.exists || d.get("categorySource") !== "manual" || typeof d.get("category") !== "string") continue;
          const sub = d.get("subcategory");
          found.set(d.id, { category: d.get("category"), subcategory: typeof sub === "string" && sub ? sub : null });
        }
      }
      return found;
    },
    async saveCursor(itemId, cursor) {
      await db.collection("plaidItems").doc(itemId).set({ syncCursor: cursor }, { merge: true });
    },
  };
}

/** Returns null when Plaid credentials are not configured. Never falls back to mock data. */
async function readRules(db: Firestore): Promise<CategoryRule[]> {
  const snap = await db.collection("categoryRules").get();
  return snap.docs.flatMap((d) => {
    const x = d.data();
    if (typeof x.pattern !== "string" || typeof x.category !== "string") return [];
    return [{ id: d.id, pattern: x.pattern, category: x.category, subcategory: typeof x.subcategory === "string" ? x.subcategory : null }];
  });
}

export function createFirestoreCategoryStore(projectId?: string): CategoryStore {
  const db = new Firestore({ projectId, ignoreUndefinedProperties: true });
  return {
    getRules: () => readRules(db),
    async addRules(rules) {
      for (const part of chunks(rules)) {
        const batch = db.batch();
        for (const r of part) batch.set(db.collection("categoryRules").doc(r.id), { pattern: r.pattern, category: r.category });
        await batch.commit();
      }
    },
    async getRows() {
      const snap = await db.collection("transactions").select("name", "category", "subcategory", "plaidCategory", "categorySource").get();
      return snap.docs.map((d): CategorizeRow => {
        const x = d.data();
        const s = (v: unknown) => (typeof v === "string" && v ? v : null);
        return {
          id: d.id,
          name: typeof x.name === "string" ? x.name : "",
          category: typeof x.category === "string" ? x.category : "",
          subcategory: s(x.subcategory),
          plaidCategory: s(x.plaidCategory),
          categorySource: s(x.categorySource),
        };
      });
    },
    async updateCategories(updates) {
      for (const part of chunks(updates)) {
        const batch = db.batch();
        for (const u of part) {
          batch.set(db.collection("transactions").doc(u.id), { category: u.category, subcategory: u.subcategory, categorySource: u.categorySource }, { merge: true });
        }
        await batch.commit();
      }
    },
  };
}

/**
 * Writes for the Claude write tools. Field-limited on purpose: only category,
 * subcategory, categorySource and autoCategory on transactions, categoryRules
 * documents, and new categoryAudit entries.
 */
export function createFirestoreCategoryWriteStore(projectId?: string): CategoryWriteStore {
  const db = new Firestore({ projectId, ignoreUndefinedProperties: true });
  const base = createFirestoreCategoryStore(projectId);
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    getRules: base.getRules,
    getRows: base.getRows,
    updateCategories: base.updateCategories,
    async getTransaction(id) {
      const d = await db.collection("transactions").doc(id).get();
      if (!d.exists) return null;
      const x = d.data() ?? {};
      return {
        id: d.id,
        name: typeof x.name === "string" ? x.name : "",
        category: typeof x.category === "string" ? x.category : "",
        subcategory: s(x.subcategory),
        plaidCategory: s(x.plaidCategory),
        categorySource: s(x.categorySource),
        isPending: x.isPending === true,
        autoCategory: s(x.autoCategory),
      };
    },
    async setTransactionCategory(id, v) {
      await db.collection("transactions").doc(id).update({
        category: v.category,
        subcategory: v.subcategory,
        categorySource: v.categorySource,
        autoCategory: v.autoCategory,
      });
    },
    async createRule(r) {
      await db.collection("categoryRules").doc(r.id).create({ id: r.id, pattern: r.pattern, category: r.category, ...(r.subcategory ? { subcategory: r.subcategory } : {}) });
    },
    async deleteRule(id) {
      await db.collection("categoryRules").doc(id).delete({ exists: true });
    },
    async addAudit(entry) {
      await db.collection("categoryAudit").add(entry);
    },
  };
}

export function createFirestoreLinkStore(projectId?: string): LinkStore {
  const db = new Firestore({ projectId, ignoreUndefinedProperties: true });
  return {
    async getPlaidItem(itemId) {
      const d = await db.collection("plaidItems").doc(itemId).get();
      const t = d.exists ? d.get("accessToken") : null;
      return typeof t === "string" ? { accessToken: t } : null;
    },
    async listInstitutionNames() {
      const snap = await db.collection("plaidItems").select("institutionName").get();
      return snap.docs.map((d) => String(d.get("institutionName") ?? "")).filter(Boolean);
    },
    async savePlaidItem(item) {
      await db.collection("plaidItems").doc(item.itemId).set(item, { merge: true });
    },
  };
}

export function createPlaidFromEnv(env = process.env): (PlaidLike & LinkPlaidLike) | null {
  const clientId = env.PLAID_CLIENT_ID;
  const secret = env.PLAID_SECRET;
  if (!clientId || !secret) return null;
  const name = env.PLAID_ENV || "production";
  const basePath = PlaidEnvironments[name];
  if (!basePath) throw new Error(`Unknown PLAID_ENV "${name}" (use sandbox or production)`);
  return new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: { headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret } },
    }),
  ) as unknown as PlaidLike & LinkPlaidLike;
}
