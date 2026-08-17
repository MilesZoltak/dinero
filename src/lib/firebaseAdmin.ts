import * as admin from 'firebase-admin';

let db: any = null;

try {
  const adminAny = admin as any;

  if (!adminAny.apps || !adminAny.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'dinero-3e826';
    const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT_DINERO_3E826 || process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (saEnv) {
      try {
        const serviceAccount = typeof saEnv === 'string' && saEnv.trim().startsWith('{') ? JSON.parse(saEnv) : saEnv;
        adminAny.initializeApp({
          credential: adminAny.credential.cert(serviceAccount),
          projectId,
        });
      } catch {
        adminAny.initializeApp({ projectId });
      }
    } else {
      adminAny.initializeApp({ projectId });
    }
  }

  db = adminAny.firestore();
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (_) {}
  console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
  console.error('Failed to initialize Firebase Admin SDK:', error);
}

export { db };
export default admin;
