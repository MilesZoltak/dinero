import { NextResponse } from 'next/server';
import { db } from './firebaseAdmin';
import { authorize } from './authCore';

const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'dinero-3e826';

let cache: { emails: string[]; at: number } | null = null;
const CACHE_MS = 60_000;

/**
 * The allowlist is the Firestore document config/auth with an `allowedEmails`
 * array. It is kept out of the repo on purpose (the repo is public).
 */
async function getAllowedEmails(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.emails;
  if (!db) throw new Error('Firestore unavailable');
  const snap = await db.collection('config').doc('auth').get();
  const list = snap.exists ? snap.data()?.allowedEmails : null;
  const emails = Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string') : [];
  cache = { emails, at: Date.now() };
  return emails;
}

/**
 * Call first in every API route handler. Returns an error response to send back,
 * or null when the caller is signed in and on the allowlist.
 */
export async function requireUser(request: Request): Promise<NextResponse | null> {
  const result = await authorize(request.headers.get('authorization'), {
    projectId: PROJECT_ID,
    getAllowedEmails,
  });
  if (result.ok) return null;
  return NextResponse.json({ error: result.error }, { status: result.status });
}
