import { Firestore } from "@google-cloud/firestore";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import type { ItemRecord, PlaidLike, SyncStore } from "./sync.ts";

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
    async saveCursor(itemId, cursor) {
      await db.collection("plaidItems").doc(itemId).set({ syncCursor: cursor }, { merge: true });
    },
  };
}

/** Returns null when Plaid credentials are not configured. Never falls back to mock data. */
export function createPlaidFromEnv(env = process.env): PlaidLike | null {
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
  ) as unknown as PlaidLike;
}
