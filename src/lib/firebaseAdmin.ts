import admin from 'firebase-admin';

let db: any = null;

try {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    const adminAny = admin as any;
    if (!adminAny.apps || !adminAny.apps.length) {
      const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');
      adminAny.initializeApp({
        credential: adminAny.credential.cert({
          projectId,
          clientEmail,
          privateKey: formattedPrivateKey,
        }),
      });
    }
    db = adminAny.firestore();
    console.log('Firebase Admin SDK initialized successfully.');
  } else {
    console.warn(
      'Firebase server-side credentials missing in .env.local. Falling back to local data file database.'
    );
  }
} catch (error) {
  console.error('Failed to initialize Firebase Admin SDK:', error);
}

export { db };
export default admin;
