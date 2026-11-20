import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT, generateKeyPair, createLocalJWKSet, exportJWK } from 'jose';
import { authorize } from './authCore.ts';

const PROJECT = 'dinero-test';
const { publicKey, privateKey } = await generateKeyPair('RS256');
const other = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), alg: 'RS256', use: 'sig', kid: 'k1' };
const keys = createLocalJWKSet({ keys: [jwk] });

const sign = (claims = {}, { key = privateKey, iss = `https://securetoken.google.com/${PROJECT}`, aud = PROJECT, exp = '1h' } = {}) =>
  new SignJWT({ email: 'me@example.com', email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject('uid1')
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);

const run = (header, allowed = ['me@example.com']) =>
  authorize(header, { projectId: PROJECT, keys, getAllowedEmails: async () => allowed });

test('accepts a valid token for an allowlisted email, case-insensitively', async () => {
  const r = await run(`Bearer ${await sign({ email: 'Me@Example.com' })}`);
  assert.deepEqual(r, { ok: true, email: 'me@example.com' });
});

test('rejects missing header and non-bearer schemes', async () => {
  assert.equal((await run(null)).status, 401);
  assert.equal((await run('Basic abc')).status, 401);
});

test('rejects garbage, wrong signature, wrong issuer, wrong audience and expired tokens', async () => {
  assert.equal((await run('Bearer not.a.jwt')).status, 401);
  assert.equal((await run(`Bearer ${await sign({}, { key: other.privateKey })}`)).status, 401);
  assert.equal((await run(`Bearer ${await sign({}, { iss: 'https://evil.example' })}`)).status, 401);
  assert.equal((await run(`Bearer ${await sign({}, { aud: 'other-project' })}`)).status, 401);
  assert.equal((await run(`Bearer ${await sign({}, { exp: '-1h' })}`)).status, 401);
});

test('rejects unverified email', async () => {
  assert.equal((await run(`Bearer ${await sign({ email_verified: false })}`)).status, 401);
});

test('403 for a valid user who is not allowlisted, and fails closed on empty or broken allowlist', async () => {
  const h = `Bearer ${await sign()}`;
  assert.equal((await run(h, ['someone@else.com'])).status, 403);
  assert.equal((await run(h, [])).status, 403);
  const broken = await authorize(h, { projectId: PROJECT, keys, getAllowedEmails: async () => { throw new Error('down'); } });
  assert.equal(broken.status, 403);
});
