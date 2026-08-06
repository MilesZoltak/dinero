let db: any = null;
let admin: any = null;

try {
  admin = require('firebase-admin');
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
      try {
        adminAny.initializeApp({
          projectId,
          credential: adminAny.credential.applicationDefault(),
        });
      } catch {
        adminAny.initializeApp({ projectId });
      }
    }
  }

  db = adminAny.firestore();
  console.log('Firebase Admin SDK initialized successfully using Managed Identity / ADC.');
} catch (error) {
  console.error('Failed to initialize Firebase Admin SDK via Managed Identity:', error);
}

export { db };
export default admin;

