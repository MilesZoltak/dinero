'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Sparkles, 
  ArrowRight, 
  Database,
  CloudLightning,
  Lock,
  Mail,
  UserPlus
} from 'lucide-react';
import { auth, isFirebaseEnabled } from '@/lib/firebaseClient';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  onAuthStateChanged
} from 'firebase/auth';

export default function EntryPage() {
  const router = useRouter();
  const [firebaseActive, setFirebaseActive] = useState<boolean>(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const active = isFirebaseEnabled();
    setFirebaseActive(active);

    if (active && auth) {
      // Listen for authenticated session
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

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError(null);
    setLoading(true);

    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth!, email, password);
      } else {
        await signInWithEmailAndPassword(auth!, email, password);
      }
      router.push('/dashboard');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Authentication failed. Please verify credentials.');
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
        <div style={{ width: '40px', height: '40px', border: '3px solid rgba(0,229,255,0.1)', borderTopColor: '#00e5ff', borderRadius: '50%' }} className="animate-spin"></div>
        <span style={{ color: 'var(--text-secondary)' }}>Securing connection...</span>
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
      <div style={{ textAlign: 'center', marginBottom: '32px' }} className="animated-fade-in">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '12px' }}>
          <Sparkles size={40} style={{ color: '#00e5ff' }} />
          <span style={{ fontSize: '42px', fontWeight: 800, background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.04em' }}>dinero</span>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '16px', maxWidth: '440px', margin: '0 auto', lineHeight: '1.6' }}>
          Get your assets, credit cards, investments, 401ks, and HSAs organized under one roof. Clean, beautiful, and completely custom.
        </p>
      </div>

      {/* Database status banner */}
      <div className="animated-fade-in" style={{ width: '100%', maxWidth: '440px', marginBottom: '24px' }}>
        {firebaseActive ? (
          <div className="system-notification info" style={{ margin: 0, justifyContent: 'center' }}>
            <CloudLightning size={16} style={{ color: '#10b981', marginRight: '8px' }} />
            <span>Cloud authentication enabled. Sign in to secure your portfolio.</span>
          </div>
        ) : (
          <div className="system-notification" style={{ margin: 0, justifyContent: 'center', background: 'rgba(245,158,11,0.06)', borderColor: 'rgba(245,158,11,0.15)' }}>
            <Database size={16} style={{ color: '#f59e0b', marginRight: '8px' }} />
            <span>Running locally. No credentials required to test dashboard.</span>
          </div>
        )}
      </div>

      {/* Main card interface */}
      <div className="glass-panel animated-fade-in" style={{ width: '100%', maxWidth: '440px', padding: '36px' }}>
        {firebaseActive ? (
          /* Cloud Auth Form */
          <form onSubmit={handleAuth}>
            <div className="form-header" style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '24px' }}>{isRegistering ? 'Create Portfolio' : 'Welcome Back'}</h2>
              <p style={{ color: 'var(--text-secondary)' }}>
                {isRegistering ? 'Enter email and password to secure your assets' : 'Enter credentials to access your dashboard'}
              </p>
            </div>

            {error && (
              <div className="system-notification" style={{ background: 'rgba(244,63,94,0.1)', borderColor: 'rgba(244,63,94,0.2)', color: 'var(--color-expense)', marginBottom: '16px' }}>
                <span style={{ fontSize: '13px' }}>{error}</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Email Address</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="email" 
                  className="input-field" 
                  placeholder="name@domain.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ paddingLeft: '40px' }}
                  required
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">Security Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="password" 
                  className="input-field" 
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ paddingLeft: '40px' }}
                  required
                />
              </div>
            </div>

            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              disabled={loading}
            >
              <span>{isRegistering ? 'Build Portfolio' : 'Access Dashboard'}</span>
              <ArrowRight size={16} />
            </button>

            <div className="auth-switch-text">
              {isRegistering ? 'Already have an account?' : 'New to Dinero?'}
              <span 
                className="auth-switch-link" 
                onClick={() => { setIsRegistering(!isRegistering); setError(null); }}
              >
                {isRegistering ? 'Sign In' : 'Create Account'}
              </span>
            </div>
          </form>
        ) : (
          /* Local Offline Entry */
          <div style={{ textAlign: 'center' }}>
            <div className="form-header" style={{ marginBottom: '28px' }}>
              <h2 style={{ fontSize: '24px' }}>Offline Sandbox</h2>
              <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                You are in developer mode. Your accounts and transactions will be saved to your local project folder (<code>data/db.json</code>).
              </p>
            </div>

            <button 
              onClick={handleLocalAccess}
              className="btn btn-primary" 
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '16px' }}
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
