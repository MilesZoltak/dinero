'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Sparkles, 
  ArrowRight, 
  Database,
  CloudLightning
} from 'lucide-react';
import { auth, isFirebaseEnabled } from '@/lib/firebaseClient';
import { 
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged
} from 'firebase/auth';

export default function EntryPage() {
  const router = useRouter();
  const [firebaseActive, setFirebaseActive] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const active = isFirebaseEnabled();
    setFirebaseActive(active);

    if (active && auth) {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) {
          router.push('/dashboard');
        }
        setCheckingAuth(false);
      });
      return () => unsubscribe();
    } else {
      setCheckingAuth(false);
    }
  }, [router]);

  const handleGoogleSignIn = async () => {
    if (!auth) return;
    setError(null);
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      router.push('/dashboard');
    } catch (err: any) {
      console.error('Google Sign-In Error:', err);
      
      // Handle browser popup blocks or IndexedDB closing errors
      if (err.code === 'auth/internal-error' || err.code === 'auth/web-storage-unsupported' || err.message?.includes('database closing')) {
        try {
          const provider = new GoogleAuthProvider();
          const { signInWithRedirect } = await import('firebase/auth');
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectErr: any) {
          setError('Storage access blocked by browser settings. Please check cookies/storage permissions.');
        }
      } else if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message || 'Google Sign-In failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLocalAccess = () => {
    router.push('/dashboard');
  };

  if (checkingAuth) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '16px' }}>
        <div style={{ width: '40px', height: '40px', border: '3px solid rgba(16, 185, 129, 0.15)', borderTopColor: '#10b981', borderRadius: '50%' }} className="animate-spin"></div>
        <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Securing connection...</span>
      </div>
    );
  }

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '100vh', 
      padding: '24px' 
    }}>
      
      {/* Brand logo container */}
      <div style={{ textAlign: 'center', marginBottom: '28px' }} className="animated-fade-in">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '12px' }}>
          <Sparkles size={38} style={{ color: '#10b981' }} />
          <span style={{ fontSize: '42px', fontWeight: 800, background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.04em' }}>dinero</span>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '15px', maxWidth: '420px', margin: '0 auto', lineHeight: '1.55' }}>
          Your personal financial center. Track accounts, spend, and wealth seamlessly in one place.
        </p>
      </div>



      {/* Main card interface */}
      <div className="glass-panel animated-fade-in" style={{ width: '100%', maxWidth: '420px', padding: '32px 28px' }}>
        {firebaseActive ? (
          <div style={{ textAlign: 'center' }}>
            <div className="form-header" style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '6px' }}>Welcome to Dinero</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.5' }}>
                Sign in with your Google account to access your portfolio securely.
              </p>
            </div>

            {error && (
              <div className="system-notification" style={{ background: 'rgba(244,63,94,0.1)', borderColor: 'rgba(244,63,94,0.2)', color: 'var(--color-expense)', marginBottom: '20px', padding: '10px 14px' }}>
                <span style={{ fontSize: '13px' }}>{error}</span>
              </div>
            )}

            <button 
              type="button" 
              onClick={handleGoogleSignIn}
              disabled={loading}
              style={{ 
                width: '100%', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                gap: '12px',
                padding: '14px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'rgba(255, 255, 255, 0.06)',
                color: '#ffffff',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <span>{loading ? 'Signing in...' : 'Continue with Google'}</span>
            </button>
          </div>
        ) : (
          /* Local Offline Entry */
          <div style={{ textAlign: 'center' }}>
            <div className="form-header" style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '6px' }}>Offline Sandbox</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.5' }}>
                You are in developer mode. Your accounts and transactions will be saved to your local project folder (<code>data/db.json</code>).
              </p>
            </div>

            <button 
              onClick={handleLocalAccess}
              className="btn btn-primary" 
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '14px' }}
            >
              <span>Launch Dashboard</span>
              <ArrowRight size={18} />
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

