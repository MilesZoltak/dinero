let db: any = null;
let admin: any = null;

try {
  admin = require('firebase-admin');
  const adminAny = admin as any;

  if (!adminAny.apps || !adminAny.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'dinero-3e826';
    
    // Uses Google Managed Identity / Application Default Credentials (ADC)
    // In local dev: uses `gcloud auth application-default login`
    // In GCP / App Hosting: uses Google Managed Identity automatically
    adminAny.initializeApp({
      projectId,
      credential: adminAny.credential.applicationDefault(),
    });
  }

  db = adminAny.firestore();
  console.log('Firebase Admin SDK initialized successfully using Managed Identity / ADC.');
} catch (error) {
  console.error('Failed to initialize Firebase Admin SDK via Managed Identity:', error);
}

export { db };
export default admin;

