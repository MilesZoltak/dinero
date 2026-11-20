import { KeyManagementServiceClient } from "@google-cloud/kms";

/**
 * Encryption at rest for Plaid access tokens in Firestore plaidItems.
 *
 * Tokens are encrypted with a Cloud KMS key, so the key material never leaves
 * Google and nothing extra has to be stored or rotated by hand. The item id is
 * bound in as additional authenticated data, so a ciphertext copied onto a
 * different item does not decrypt.
 *
 * Stored format: "kms1:" + base64 ciphertext. A value without that prefix is a
 * legacy plaintext token; it still works for reading until it is migrated.
 */

export const ENCRYPTED_PREFIX = "kms1:";

export interface TokenCipher {
  encrypt(plaintext: string, itemId: string): Promise<string>;
  decrypt(stored: string, itemId: string): Promise<string>;
}

export class TokenCryptoError extends Error {}

export const isEncrypted = (stored: string) => stored.startsWith(ENCRYPTED_PREFIX);

const aad = (itemId: string) => Buffer.from(`dinero:plaidItems/${itemId}`);

/** The low-level KMS calls, separated so tests can supply a fake. */
export interface KmsLike {
  encrypt(req: { name: string; plaintext: Buffer; additionalAuthenticatedData: Buffer }): Promise<[{ ciphertext?: Uint8Array | string | null }, ...unknown[]]>;
  decrypt(req: { name: string; ciphertext: Buffer; additionalAuthenticatedData: Buffer }): Promise<[{ plaintext?: Uint8Array | string | null }, ...unknown[]]>;
}

const toBuffer = (v: Uint8Array | string | null | undefined) => (typeof v === "string" ? Buffer.from(v, "base64") : Buffer.from(v ?? []));

export function createKmsCipher(keyName: string, kms: KmsLike = new KeyManagementServiceClient() as unknown as KmsLike): TokenCipher {
  return {
    async encrypt(plaintext, itemId) {
      if (!plaintext) throw new TokenCryptoError("Refusing to encrypt an empty token.");
      const [res] = await kms.encrypt({ name: keyName, plaintext: Buffer.from(plaintext, "utf8"), additionalAuthenticatedData: aad(itemId) });
      const ct = toBuffer(res.ciphertext);
      if (!ct.length) throw new TokenCryptoError("KMS returned no ciphertext.");
      return ENCRYPTED_PREFIX + ct.toString("base64");
    },
    async decrypt(stored, itemId) {
      if (!isEncrypted(stored)) return stored;
      // KMS finds the key version from the ciphertext; decrypt needs the key, not the version.
      const [res] = await kms.decrypt({ name: keyName, ciphertext: Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64"), additionalAuthenticatedData: aad(itemId) });
      const pt = toBuffer(res.plaintext).toString("utf8");
      if (!pt) throw new TokenCryptoError("KMS returned an empty token.");
      return pt;
    },
  };
}

/** Without a key: plaintext passes through, encrypted values cannot be read, nothing new gets encrypted. */
export const noKeyCipher: TokenCipher = {
  async encrypt(plaintext) {
    return plaintext;
  },
  async decrypt(stored) {
    if (isEncrypted(stored)) throw new TokenCryptoError("This token is encrypted but KMS_KEY_NAME is not set.");
    return stored;
  },
};

export function cipherFromEnv(env = process.env): TokenCipher {
  const key = env.KMS_KEY_NAME;
  if (!key) return noKeyCipher;
  if (!/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(key)) {
    throw new Error("KMS_KEY_NAME must be projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k> (no version).");
  }
  return createKmsCipher(key);
}

export interface TokenMigrationItem {
  itemId: string;
  institution: string;
  state: "encrypted" | "plaintext" | "mock" | "empty";
  action: "none" | "encrypt";
}

export interface TokenMigrationReport {
  dryRun: boolean;
  items: TokenMigrationItem[];
  encrypted: number;
}

export interface TokenMigrationStore {
  /** Raw stored values, never decrypted. Must never be returned to a caller. */
  listRawTokens(): Promise<{ itemId: string; institution: string; stored: string; version: string }[]>;
  /** Replaces the stored token only if the document has not changed since `version`. */
  replaceToken(itemId: string, stored: string, version: string): Promise<void>;
}

/**
 * Encrypts every plaintext token. Dry run unless apply is true. Each new
 * ciphertext is decrypted and compared before it is written, so a bad key or
 * misconfiguration can never replace a working token with an unreadable one.
 * The report holds no token material.
 */
export async function migrateTokens(store: TokenMigrationStore, cipher: TokenCipher, opts: { dryRun: boolean }): Promise<TokenMigrationReport> {
  if (!opts.dryRun && cipher === noKeyCipher) throw new TokenCryptoError("KMS_KEY_NAME is not set, so nothing can be encrypted.");
  const rows = await store.listRawTokens();
  const items: TokenMigrationItem[] = [];
  let encrypted = 0;
  for (const r of rows) {
    const state: TokenMigrationItem["state"] = !r.stored ? "empty" : isEncrypted(r.stored) ? "encrypted" : r.stored.startsWith("mock_") ? "mock" : "plaintext";
    const action = state === "plaintext" ? "encrypt" : "none";
    items.push({ itemId: r.itemId, institution: r.institution, state, action });
    if (action !== "encrypt" || opts.dryRun) continue;
    const ct = await cipher.encrypt(r.stored, r.itemId);
    if ((await cipher.decrypt(ct, r.itemId)) !== r.stored) throw new TokenCryptoError(`Round-trip check failed for ${r.itemId}; nothing written for it.`);
    await store.replaceToken(r.itemId, ct, r.version);
    encrypted++;
  }
  return { dryRun: opts.dryRun, items, encrypted };
}
