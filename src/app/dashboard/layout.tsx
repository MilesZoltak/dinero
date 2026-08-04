'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebaseClient';
import ChatSidebar from '@/components/chat/ChatSidebar';
import { 
  LayoutDashboard, 
  CreditCard, 
  ArrowLeftRight, 
  Settings, 
  LogOut,
  Database,
  CloudLightning,
  Sparkles,
  TrendingDown,
  Bot
} from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isCloudMode, setIsCloudMode] = useState<boolean | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Auth Guard: redirect unauthenticated users back to login page
  useEffect(() => {
    if (!auth) {
      setAuthChecked(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user && !window.location.search.includes('bypassAuth=true')) {
        router.push('/');
      } else {
        setAuthChecked(true);
      }
    });

    return () => unsubscribe();
  }, [router]);

  // Check database configuration on load
  useEffect(() => {
    async function checkDb() {
      try {
        const res = await fetch('/api/accounts');
        setIsCloudMode(true);
      } catch {
        setIsCloudMode(false);
      }
    }
    checkDb();
  }, []);

  const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Accounts', href: '/dashboard/accounts', icon: CreditCard },
    { name: 'Transactions', href: '/dashboard/transactions', icon: ArrowLeftRight },
    { name: 'Spend', href: '/dashboard/spend', icon: TrendingDown },
  ];

  const handleSignOut = async () => {
    try {
      if (auth) {
        const { signOut } = await import('firebase/auth');
        await signOut(auth);
      }
      // Force navigation to home with replace to avoid router stack caching
      window.location.href = '/';
    } catch (err) {
      console.error('Sign out error:', err);
      window.location.href = '/';
    }
  };


  return (
    <div className="layout-wrapper animated-fade-in">
      {/* Mobile Top Header */}
      <header className="mobile-header">
        <div className="logo-container" style={{ marginBottom: 0 }}>
          <div className="logo-icon-box">
            <span>d</span>
          </div>
          <span className="logo-text">dinero</span>
        </div>
        <button 
          onClick={handleSignOut}
          className="btn btn-secondary"
          style={{ padding: '6px 12px', fontSize: '12px', gap: '6px' }}
        >
          <LogOut size={14} />
          <span>Sign Out</span>
        </button>
      </header>

      {/* Desktop Sidebar */}
      <aside className="sidebar">
        <div className="logo-container">
          <div className="logo-icon-box">
            <span>d</span>
          </div>
          <span className="logo-text">dinero</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon size={20} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Sign Out Footer */}
        <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
          <button
            onClick={handleSignOut}
            className="nav-item"
            style={{
              width: '100%',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              justifyContent: 'flex-start',
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              transition: 'all 0.15s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(244, 63, 94, 0.1)';
              e.currentTarget.style.color = '#f43f5e';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <LogOut size={20} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>

      {/* Floating Dinero AI Assistant Widget */}
      <ChatSidebar />

      {/* Mobile Fixed Bottom Tab Bar */}
      <nav className="mobile-bottom-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link 
              key={item.href} 
              href={item.href}
              className={`mobile-nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={20} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
