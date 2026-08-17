import { Firestore } from '@google-cloud/firestore';

let db: Firestore | null = null;

try {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'dinero-3e826';
  const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT_DINERO_3E826 || process.env.FIREBASE_SERVICE_ACCOUNT;

  if (saEnv) {
    try {
      const credentials = typeof saEnv === 'string' && saEnv.trim().startsWith('{') ? JSON.parse(saEnv) : saEnv;
      db = new Firestore({
        projectId,
        credentials,
        ignoreUndefinedProperties: true,
      });
    } catch {
      db = new Firestore({
        projectId,
        ignoreUndefinedProperties: true,
      });
    }
  } else {
    db = new Firestore({
      projectId,
      ignoreUndefinedProperties: true,
    });
  }
  console.log('Firestore initialized successfully.');
} catch (error) {
  console.error('Failed to initialize Firestore:', error);
}

export { db };
export default db;
