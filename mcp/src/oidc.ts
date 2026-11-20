import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

let googleKeys: JWTVerifyGetKey | null = null;

/**
 * Verifies a Google-signed ID token, such as the one Cloud Scheduler attaches.
 * True only for the expected service account and audience. Any problem is false.
 */
export async function verifyGoogleServiceToken(
  token: string,
  expect: { audience: string; email: string },
  keys?: JWTVerifyGetKey,
): Promise<boolean> {
  try {
    googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
    const { payload } = await jwtVerify(token, keys ?? googleKeys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: expect.audience,
      algorithms: ["RS256"],
    });
    return payload.email_verified === true && typeof payload.email === "string" && payload.email.toLowerCase() === expect.email.toLowerCase();
  } catch {
    return false;
  }
}
