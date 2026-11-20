import assert from "node:assert/strict";
import { test } from "node:test";
import { createKmsCipher, ENCRYPTED_PREFIX, isEncrypted, migrateTokens, noKeyCipher, cipherFromEnv, type KmsLike, type TokenMigrationStore } from "./tokenCrypto.ts";

const KEY = "projects/p/locations/us-central1/keyRings/r/cryptoKeys/k";

/** Reversible fake: XOR with a byte, prefixed by the AAD so a wrong AAD fails like real KMS. */
function fakeKms(): KmsLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async encrypt({ name, plaintext, additionalAuthenticatedData }) {
      calls.push(`enc:${name}`);
      const body = Buffer.concat([additionalAuthenticatedData, Buffer.from("|"), plaintext]).map((b) => b ^ 0x5a);
      return [{ ciphertext: body }];
    },
    async decrypt({ ciphertext, additionalAuthenticatedData }) {
      calls.push("dec");
      const raw = Buffer.from(ciphertext.map((b) => b ^ 0x5a));
      const sep = raw.indexOf("|");
      if (!raw.subarray(0, sep).equals(additionalAuthenticatedData)) throw new Error("3 INVALID_ARGUMENT: Decryption failed");
      return [{ plaintext: raw.subarray(sep + 1) }];
    },
  };
}

test("encrypts with a prefix, round-trips, and binds the item id", async () => {
  const kms = fakeKms();
  const c = createKmsCipher(KEY, kms);
  const ct = await c.encrypt("access-production-abc", "item1");
  assert.ok(ct.startsWith(ENCRYPTED_PREFIX));
  assert.ok(!ct.includes("access-production-abc"));
  assert.equal(await c.decrypt(ct, "item1"), "access-production-abc");
  await assert.rejects(c.decrypt(ct, "item2"), /Decryption failed/);
  assert.equal(kms.calls[0], `enc:${KEY}`);
});

test("legacy plaintext tokens still read; empty tokens are refused", async () => {
  const c = createKmsCipher(KEY, fakeKms());
  assert.equal(await c.decrypt("access-production-legacy", "i"), "access-production-legacy");
  await assert.rejects(c.encrypt("", "i"), /empty/);
});

test("without a key: plaintext passes, encrypted values fail clearly", async () => {
  assert.equal(await noKeyCipher.encrypt("tok", "i"), "tok");
  assert.equal(await noKeyCipher.decrypt("tok", "i"), "tok");
  await assert.rejects(noKeyCipher.decrypt(`${ENCRYPTED_PREFIX}abc`, "i"), /KMS_KEY_NAME/);
  assert.equal(cipherFromEnv({}), noKeyCipher);
  assert.throws(() => cipherFromEnv({ KMS_KEY_NAME: `${KEY}/cryptoKeyVersions/1` }), /no version/);
});

function memTokens(rows: { itemId: string; institution: string; stored: string }[]) {
  const s = {
    rows: rows.map((r) => ({ ...r, version: "v1" })),
    async listRawTokens() { return s.rows.map((r) => ({ ...r })); },
    async replaceToken(itemId: string, stored: string, version: string) {
      const r = s.rows.find((x) => x.itemId === itemId)!;
      if (r.version !== version) throw new Error("changed");
      r.stored = stored;
      r.version = "v2";
    },
  };
  return s satisfies TokenMigrationStore;
}

test("migration: dry run changes nothing and reports no token material", async () => {
  const store = memTokens([
    { itemId: "a", institution: "Chase", stored: "access-production-secret-a" },
    { itemId: "m", institution: "Old", stored: "mock_access_token_x" },
  ]);
  const report = await migrateTokens(store, createKmsCipher(KEY, fakeKms()), { dryRun: true });
  assert.deepEqual(report.items.map((i) => [i.itemId, i.state, i.action]), [["a", "plaintext", "encrypt"], ["m", "mock", "none"]]);
  assert.equal(report.encrypted, 0);
  assert.equal(store.rows[0].stored, "access-production-secret-a");
  assert.ok(!JSON.stringify(report).includes("secret"));
});

test("migration: apply encrypts plaintext only, verifies, and is idempotent", async () => {
  const store = memTokens([
    { itemId: "a", institution: "Chase", stored: "access-production-a" },
    { itemId: "m", institution: "Old", stored: "mock_access_token_x" },
  ]);
  const cipher = createKmsCipher(KEY, fakeKms());
  const first = await migrateTokens(store, cipher, { dryRun: false });
  assert.equal(first.encrypted, 1);
  assert.ok(isEncrypted(store.rows[0].stored));
  assert.equal(await cipher.decrypt(store.rows[0].stored, "a"), "access-production-a");
  assert.equal(store.rows[1].stored, "mock_access_token_x");
  const again = await migrateTokens(store, cipher, { dryRun: false });
  assert.equal(again.encrypted, 0);
  assert.equal(again.items[0].state, "encrypted");
});

test("migration: refuses to apply without a key, and never writes a token that fails the round trip", async () => {
  const store = memTokens([{ itemId: "a", institution: "Chase", stored: "access-production-a" }]);
  await assert.rejects(migrateTokens(store, noKeyCipher, { dryRun: false }), /KMS_KEY_NAME/);
  const broken = { encrypt: async () => `${ENCRYPTED_PREFIX}xx`, decrypt: async () => "something else" };
  await assert.rejects(migrateTokens(store, broken, { dryRun: false }), /Round-trip/);
  assert.equal(store.rows[0].stored, "access-production-a");
});
