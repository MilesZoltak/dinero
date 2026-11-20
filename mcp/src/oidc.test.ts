import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyGoogleServiceToken } from "./oidc.ts";

const AUD = "https://dinero-mcp.example.run.app";
const EMAIL = "dinero-sync@proj.iam.gserviceaccount.com";
const good = await generateKeyPair("RS256");
const evil = await generateKeyPair("RS256");
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(good.publicKey)), alg: "RS256", use: "sig", kid: "k" }] });

const sign = (over: { email?: string; verified?: boolean; aud?: string; iss?: string; exp?: string; key?: CryptoKey } = {}) =>
  new SignJWT({ email: over.email ?? EMAIL, email_verified: over.verified ?? true })
    .setProtectedHeader({ alg: "RS256", kid: "k" })
    .setIssuer(over.iss ?? "https://accounts.google.com")
    .setAudience(over.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(over.exp ?? "1h")
    .sign(over.key ?? good.privateKey);

const check = (t: string) => verifyGoogleServiceToken(t, { audience: AUD, email: EMAIL }, keys);

test("accepts a valid token from the expected service account", async () => {
  assert.equal(await check(await sign()), true);
});

test("rejects wrong account, audience, issuer, signature, expiry, unverified email and junk", async () => {
  assert.equal(await check(await sign({ email: "other@proj.iam.gserviceaccount.com" })), false);
  assert.equal(await check(await sign({ aud: "https://elsewhere" })), false);
  assert.equal(await check(await sign({ iss: "https://evil.example" })), false);
  assert.equal(await check(await sign({ key: evil.privateKey })), false);
  assert.equal(await check(await sign({ exp: "-1h" })), false);
  assert.equal(await check(await sign({ verified: false })), false);
  assert.equal(await check("not.a.jwt"), false);
});
