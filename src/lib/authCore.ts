import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let defaultKeys: JWTVerifyGetKey | null = null;
function firebaseKeys(): JWTVerifyGetKey {
  defaultKeys ??= createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  return defaultKeys;
}

export type AuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Verifies a Firebase Auth ID token (signature, issuer, audience, expiry) and
 * returns the user's verified email. Throws on any invalid token.
 */
export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  keys: JWTVerifyGetKey = firebaseKeys()
): Promise<string | null> {
  const { payload } = await jwtVerify(token, keys, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    algorithms: ['RS256'],
  });
  if (payload.email_verified !== true || typeof payload.email !== 'string') return null;
  return payload.email.toLowerCase();
}

/**
 * Full check for one request. Fails closed: with no allowlist, nobody gets in.
 */
export async function authorize(
  authorizationHeader: string | null,
  deps: {
    projectId: string;
    getAllowedEmails: () => Promise<string[]>;
    keys?: JWTVerifyGetKey;
  }
): Promise<AuthResult> {
  const match = /^Bearer (.+)$/.exec(authorizationHeader ?? '');
  if (!match) return { ok: false, status: 401, error: 'Sign in required.' };

  let email: string | null;
  try {
    email = await verifyFirebaseIdToken(match[1], deps.projectId, deps.keys);
  } catch {
    return { ok: false, status: 401, error: 'Invalid or expired session. Sign in again.' };
  }
  if (!email) return { ok: false, status: 401, error: 'A verified email is required.' };

  let allowed: string[];
  try {
    allowed = (await deps.getAllowedEmails()).map((e) => e.trim().toLowerCase());
  } catch {
    return { ok: false, status: 403, error: 'Access list unavailable.' };
  }
  if (!allowed.includes(email)) return { ok: false, status: 403, error: 'This account is not allowed.' };
  return { ok: true, email };
}
