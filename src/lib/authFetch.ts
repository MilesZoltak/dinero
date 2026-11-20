import { auth } from './firebaseClient';

/** fetch() for our own API: attaches the signed-in user's Firebase ID token. */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (auth) {
    await auth.authStateReady();
    const token = await auth.currentUser?.getIdToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
