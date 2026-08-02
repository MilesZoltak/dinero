'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  CreditCard, 
  ArrowLeftRight, 
  Settings, 
  LogOut,
  Database,
  CloudLightning,
  Sparkles,
  TrendingDown
} from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isCloudMode, setIsCloudMode] = useState<boolean | null>(null);

  // Check database configuration on load
  useEffect(() => {
    async function checkDb() {
      try {
        const res = await fetch('/api/accounts');
        setIsCloudMode(false); // Default to local for now
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isCloudMode ? (
            <CloudLightning size={16} style={{ color: '#10b981' }} />
          ) : (
            <Database size={16} style={{ color: '#f59e0b' }} />
          )}
        </div>
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

        {/* Database Status Widget in Sidebar */}
        <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
          <div 
            className="glass-panel" 
            style={{ 
              padding: '16px', 
              fontSize: '13px', 
              borderColor: isCloudMode ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
              background: isCloudMode ? 'rgba(16, 185, 129, 0.04)' : 'rgba(245, 158, 11, 0.04)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', fontWeight: 600 }}>
              {isCloudMode ? (
                <>
                  <CloudLightning size={16} style={{ color: '#10b981' }} />
                  <span style={{ color: '#10b981' }}>Cloud Firestore</span>
                </>
              ) : (
                <>
                  <Database size={16} style={{ color: '#f59e0b' }} />
                  <span style={{ color: '#f59e0b' }}>Local Sandbox Mode</span>
                </>
              )}
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '11px', lineHeight: '1.4' }}>
              {isCloudMode 
                ? 'Your financial portfolio is backed up securely in Google Cloud.' 
                : 'Data saved to local workspace file (data/db.json). Config env vars to use Firestore.'}
            </p>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>

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
