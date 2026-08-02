'use client';

import React, { useEffect, useState } from 'react';
import { 
  RefreshCw, 
  TrendingUp, 
  Wallet, 
  PiggyBank, 
  LineChart as ChartIcon, 
  ArrowRight,
  Info,
  Calendar
} from 'lucide-react';
import { Chart as ChartJS, registerables } from 'chart.js';
import { Doughnut, Line } from 'react-chartjs-2';
import Link from 'next/link';

ChartJS.register(...registerables);

interface Account {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string;
  balance: number;
  institutionName: string;
  isManual: boolean;
  itemId?: string | null;
  lastSync?: string | null;
}

interface Transaction {
  id: string;
  accountId: string;
  amount: number;
  date: string;
  name: string;
  category: string;
  isPending: boolean;
  isManual: boolean;
}

export default function Dashboard() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Timescale configuration
  const [timescale, setTimescale] = useState<'week' | 'month' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | 'all' | 'custom'>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const fetchData = async () => {
    try {
      const accountsRes = await fetch('/api/accounts');
      const accountsData = await accountsRes.json();
      
      const transactionsRes = await fetch('/api/transactions');
      const transactionsData = await transactionsRes.json();

      setAccounts(accountsData.accounts || []);
      setTransactions(transactionsData.transactions || []);
      
      // Set default range for custom selector
      const today = new Date().toISOString().split('T')[0];
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      setCustomStart(thirtyDaysAgo.toISOString().split('T')[0]);
      setCustomEnd(today);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/plaid/sync', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        setSyncMessage(`Error: ${data.error}`);
      } else {
        setSyncMessage(data.message);
        if (data.accounts) setAccounts(data.accounts);
        if (data.transactions) setTransactions(data.transactions);
      }
    } catch (error) {
      console.error('Sync failed:', error);
      setSyncMessage('Failed to sync. Please try again.');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  // Math helper calculations
  const cashAccounts = accounts.filter(a => a.type === 'depository');
  const investmentAccounts = accounts.filter(a => a.type === 'investment');
  const creditAccounts = accounts.filter(a => a.type === 'credit');

  const cashBalance = cashAccounts.reduce((sum, a) => sum + a.balance, 0);
  const investmentBalance = investmentAccounts.reduce((sum, a) => sum + a.balance, 0);
  const creditBalance = creditAccounts.reduce((sum, a) => sum + a.balance, 0);

  const totalAssets = cashBalance + investmentBalance;
  const totalLiabilities = creditBalance;
  const netWorth = totalAssets - totalLiabilities;

  // Reconstruct daily net worth history based on selected timescale
  const getNetWorthHistoryForRange = () => {
    let days = 30;
    const today = new Date();
    let startDateObj = new Date();
    let endDateObj = new Date();
    
    if (timescale === 'week') {
      days = 7;
      startDateObj.setDate(today.getDate() - 6);
    } else if (timescale === 'month') {
      days = 30;
      startDateObj.setDate(today.getDate() - 29);
    } else if (timescale === '3m') {
      days = 90;
      startDateObj.setDate(today.getDate() - 89);
    } else if (timescale === '6m') {
      days = 180;
      startDateObj.setDate(today.getDate() - 179);
    } else if (timescale === 'ytd') {
      const jan1 = new Date(today.getFullYear(), 0, 1);
      days = Math.ceil((today.getTime() - jan1.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      startDateObj = jan1;
    } else if (timescale === '1y') {
      days = 365;
      startDateObj.setDate(today.getDate() - 364);
    } else if (timescale === '2y') {
      days = 730;
      startDateObj.setDate(today.getDate() - 729);
    } else if (timescale === '5y') {
      days = 1825;
      startDateObj.setDate(today.getDate() - 1824);
    } else if (timescale === 'all') {
      if (transactions.length > 0) {
        const sortedTxs = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
        const oldestTxDate = new Date(sortedTxs[0].date);
        if (!isNaN(oldestTxDate.getTime())) {
          startDateObj = oldestTxDate;
          days = Math.ceil((today.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        } else {
          days = 365;
          startDateObj.setDate(today.getDate() - 364);
        }
      } else {
        days = 30;
        startDateObj.setDate(today.getDate() - 29);
      }
    } else if (timescale === 'custom') {
      const s = new Date(customStart);
      const e = new Date(customEnd);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && s <= e) {
        startDateObj = s;
        endDateObj = e;
        days = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      } else {
        days = 30;
        startDateObj.setDate(today.getDate() - 29);
      }
    }
    
    // Generate dates mapping array
    const labels: string[] = [];
    const dateStrings: string[] = [];
    
    for (let i = 0; i < days; i++) {
      const tempDate = new Date(startDateObj);
      tempDate.setDate(startDateObj.getDate() + i);
      if (tempDate > endDateObj) break;
      
      // Determine label intervals based on chart width density
      let labelFormat: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
      if (days > 365) labelFormat = { year: 'numeric', month: 'short' };
      
      labels.push(tempDate.toLocaleDateString('en-US', labelFormat));
      dateStrings.push(tempDate.toISOString().split('T')[0]);
    }
    
    // Group transactions by YYYY-MM-DD
    const txsGroupedByDate: Record<string, Transaction[]> = {};
    transactions.forEach(tx => {
      if (!txsGroupedByDate[tx.date]) {
        txsGroupedByDate[tx.date] = [];
      }
      txsGroupedByDate[tx.date].push(tx);
    });
    
    // Calculate daily ledger backwards
    const dailyNetWorthMap: Record<string, number> = {};
    let runningNetWorth = netWorth;
    
    const todayStr = today.toISOString().split('T')[0];
    dailyNetWorthMap[todayStr] = runningNetWorth;
    
    // Build backward mapping index
    const backwardDates: string[] = [];
    const maxBackwardWalk = Math.max(days + 60, 1850); // Allow walking back 5y if selected
    for (let i = 0; i < maxBackwardWalk; i++) {
      const temp = new Date(today);
      temp.setDate(today.getDate() - i);
      backwardDates.push(temp.toISOString().split('T')[0]);
    }
    
    for (let i = 0; i < backwardDates.length - 1; i++) {
      const curDateStr = backwardDates[i];
      const prevDateStr = backwardDates[i + 1];
      
      const dayTxs = txsGroupedByDate[curDateStr] || [];
      const dayChange = dayTxs.reduce((sum, tx) => sum - tx.amount, 0);
      
      runningNetWorth = runningNetWorth - dayChange;
      dailyNetWorthMap[prevDateStr] = runningNetWorth;
    }
    
    // Identify limits of actual logged records
    let oldestKnownDateStr = todayStr;
    if (transactions.length > 0) {
      const sortedTxs = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
      oldestKnownDateStr = sortedTxs[0].date;
    }
    
    const oldestKnownValue = dailyNetWorthMap[oldestKnownDateStr] || runningNetWorth;
    
    // Fill in labels values matching range
    const dataPoints = dateStrings.map(dStr => {
      if (dailyNetWorthMap[dStr] !== undefined && dStr >= oldestKnownDateStr) {
        return parseFloat(dailyNetWorthMap[dStr].toFixed(2));
      } else {
        // For historical dates before the oldest synced transaction record, hold at the oldest known ledger balance
        return parseFloat(oldestKnownValue.toFixed(2));
      }
    });
    
    return {
      labels,
      data: dataPoints,
      isExtrapolated: false
    };
  };

  const netWorthHistory = getNetWorthHistoryForRange();

  // Chart 1: Doughnut Chart (Asset Allocation)
  const doughnutData = {
    labels: ['Cash / Checking', 'Regular Savings', 'High-Yield Savings (HYSA)', 'Brokerage Investments', 'Retirement / 401(k)'],
    datasets: [
      {
        data: [
          accounts.filter(a => a.subtype === 'checking').reduce((sum, a) => sum + a.balance, 0),
          accounts.filter(a => a.subtype === 'savings').reduce((sum, a) => sum + a.balance, 0),
          accounts.filter(a => a.subtype === 'hysa').reduce((sum, a) => sum + a.balance, 0),
          accounts.filter(a => a.subtype === 'brokerage').reduce((sum, a) => sum + a.balance, 0),
          accounts.filter(a => a.subtype === '401k' || a.subtype === 'retirement' || a.subtype === 'ira').reduce((sum, a) => sum + a.balance, 0),
        ],
        backgroundColor: [
          'rgba(127, 176, 105, 0.85)', /* Sage Green */
          'rgba(212, 163, 115, 0.85)', /* Sandstone / Wood */
          'rgba(82, 121, 111, 0.95)',  /* Forest Evergreen */
          'rgba(224, 122, 95, 0.85)',  /* Terracotta Earth */
          'rgba(163, 201, 168, 0.85)', /* Moss Green */
        ],
        borderColor: [
          '#7fb069',
          '#d4a373',
          '#52796f',
          '#e07a5f',
          '#a3c9a8',
        ],
        borderWidth: 1.5,
      },
    ],
  };

  const doughnutOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
    },
    cutout: '72%',
  };

  // Chart 2: Net Worth Line Chart
  const lineData = {
    labels: netWorthHistory.labels,
    datasets: [
      {
        label: 'Net Worth',
        data: netWorthHistory.data,
        fill: true,
        borderColor: '#52796f',
        backgroundColor: 'rgba(82, 121, 111, 0.08)',
        tension: 0.15,
        pointBackgroundColor: '#52796f',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 1.5,
        pointRadius: netWorthHistory.labels.length > 90 ? 0 : 2,
        pointHoverRadius: 4,
      },
    ],
  };

  const lineOptions = {
    responsive: true,
    scales: {
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.03)' },
        ticks: { 
          color: '#64748b', 
          font: { family: 'Plus Jakarta Sans', size: 10 },
          callback: (value: any) => '$' + value.toLocaleString(),
        },
      },
      x: {
        grid: { display: false },
        ticks: { 
          color: '#64748b', 
          font: { family: 'Plus Jakarta Sans', size: 9 },
          // Downsample ticks if range is wide
          maxTicksLimit: 10,
        },
      },
    },
    plugins: {
      legend: { display: false },
    },
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(val);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', flexDirection: 'column', gap: '16px' }}>
        <RefreshCw className="animate-spin" size={40} style={{ color: '#34d399' }} />
        <span style={{ color: 'var(--text-secondary)' }}>Gathering financial records...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      
      {/* Header section */}
      <header className="dashboard-header">
        <div className="header-title-section">
          <h1>Wealth Overview</h1>
          <p>Consolidated tracking of all your financial resources</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button 
            className="btn btn-secondary" 
            onClick={handleSync}
            disabled={syncing || accounts.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
          <Link href="/dashboard/accounts" className="btn btn-primary">
            Link Account
          </Link>
        </div>
      </header>

      {/* Sync Alerts */}
      {syncMessage && (
        <div className="system-notification info">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Info size={16} style={{ color: 'var(--accent-cyan)' }} />
            <span>{syncMessage}</span>
          </div>
        </div>
      )}

      {/* Zero accounts onboarding helper */}
      {accounts.length === 0 && (
        <div className="glass-panel" style={{ padding: '36px', textAlign: 'center', maxWidth: '640px', margin: '40px auto' }}>
          <Wallet size={48} style={{ color: '#34d399', marginBottom: '16px' }} />
          <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Welcome to Dinero</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: '1.6' }}>
            To get started tracking your net worth, connect a bank or brokerage account via Plaid Sandbox, or create manual asset accounts.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
            <Link href="/dashboard/accounts" className="btn btn-primary">
              Connect accounts
            </Link>
          </div>
        </div>
      )}

      {accounts.length > 0 && (
        <>
          {/* Main metrics display */}
          <section className="metrics-grid">
            <div className="metric-card glass-panel networth">
              <div className="metric-label">Net Worth</div>
              <div className="metric-value">{formatCurrency(netWorth)}</div>
              <div className="metric-change positive">
                <TrendingUp size={14} />
                <span>Real-time sync</span>
              </div>
            </div>

            <div className="metric-card glass-panel income">
              <div className="metric-label">Cash / Deposits</div>
              <div className="metric-value">{formatCurrency(cashBalance)}</div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Across {cashAccounts.length} checking & savings account(s)
              </p>
            </div>

            <div className="metric-card glass-panel investment">
              <div className="metric-label">Investments</div>
              <div className="metric-value">{formatCurrency(investmentBalance)}</div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Across {investmentAccounts.length} portfolio account(s)
              </p>
            </div>

            <div className="metric-card glass-panel expense">
              <div className="metric-label">Credit Card Debt</div>
              <div className="metric-value" style={{ color: creditBalance > 0 ? 'var(--color-expense)' : 'inherit' }}>
                {formatCurrency(creditBalance)}
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Accumulated liabilities on {creditAccounts.length} card(s)
              </p>
            </div>
          </section>

          {/* Interactive visual charts */}
          <section className="charts-section">
            
            {/* Net Worth Line Chart with Range Selectors */}
            <div className="chart-card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="chart-header" style={{ marginBottom: 0 }}>
                <h3 className="chart-title">Net Worth Progression</h3>
                <ChartIcon size={18} style={{ color: '#34d399' }} />
              </div>
              
              {/* Timescale Selector Button Group */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {(['week', 'month', '3m', '6m', 'ytd', '1y', '2y', '5y', 'all', 'custom'] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setTimescale(opt)}
                      className={`btn ${timescale === opt ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ 
                        padding: '6px 12px', 
                        fontSize: '11px', 
                        borderRadius: '6px',
                        textTransform: 'uppercase',
                        fontWeight: 600,
                        border: timescale === opt ? 'none' : '1px solid rgba(255,255,255,0.06)'
                      }}
                    >
                      {opt === 'all' ? 'all time' : opt}
                    </button>
                  ))}
                </div>

                {/* Custom Date Range Picker panel */}
                {timescale === 'custom' && (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '16px', 
                    background: 'rgba(255,255,255,0.02)', 
                    padding: '12px', 
                    borderRadius: '8px', 
                    border: '1px solid rgba(255,255,255,0.05)',
                    width: 'fit-content'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Calendar size={14} style={{ color: 'var(--text-secondary)' }} />
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Range:</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="date"
                        className="input-field"
                        style={{ padding: '6px 8px', fontSize: '12px', width: '130px', background: 'black', border: '1px solid rgba(255,255,255,0.1)' }}
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                      />
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>to</span>
                      <input
                        type="date"
                        className="input-field"
                        style={{ padding: '6px 8px', fontSize: '12px', width: '130px', background: 'black', border: '1px solid rgba(255,255,255,0.1)' }}
                        value={customEnd}
                        onChange={(e) => setCustomEnd(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Chart Line Mount */}
              <div style={{ position: 'relative', height: '280px', width: '100%' }}>
                <Line data={lineData} options={lineOptions} />
              </div>

              {/* Footnote explanation */}
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '10px' }}>
                <Info size={12} style={{ color: 'var(--accent-cyan)' }} />
                <span>
                  {netWorthHistory.isExtrapolated 
                    ? 'Includes estimated historical asset trends prior to account linking setup' 
                    : 'Reconstructed daily ledger from synced transaction history'}
                </span>
              </div>
            </div>

            {/* Asset Allocation Card */}
            <div className="chart-card glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="chart-header">
                <h3 className="chart-title">Asset Allocation</h3>
                <PiggyBank size={18} style={{ color: '#10b981' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '20px' }}>
                {totalAssets > 0 ? (
                  <>
                    <div style={{ position: 'relative', height: '160px', width: '100%', display: 'flex', justifyContent: 'center' }}>
                      <Doughnut data={doughnutData} options={doughnutOptions} />
                    </div>
                    {/* Custom HTML Legend */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '16px' }}>
                      {doughnutData.labels.map((label, idx) => {
                        const val = doughnutData.datasets[0].data[idx];
                        if (val <= 0) return null; // Only show non-zero segments
                        const pct = totalAssets > 0 ? ((val / totalAssets) * 100).toFixed(1) : '0';
                        return (
                          <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{
                                display: 'inline-block',
                                width: '10px',
                                height: '10px',
                                borderRadius: '50%',
                                backgroundColor: doughnutData.datasets[0].borderColor[idx]
                              }} />
                              <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                            </div>
                            <span style={{ fontWeight: 600, color: 'white', fontFamily: 'Outfit' }}>
                              {formatCurrency(val)} <span style={{ color: 'var(--text-secondary)', fontSize: '10px', marginLeft: '4px' }}>({pct}%)</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)', fontSize: '14px', height: '200px' }}>
                    No assets recorded to display.
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Recent transaction feed overview */}
          <section className="transactions-panel glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3>Recent Activity</h3>
              <Link href="/dashboard/transactions" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#34d399', textDecoration: 'none', fontSize: '14px', fontWeight: 600 }}>
                <span>View Full Feed</span>
                <ArrowRight size={16} />
              </Link>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="tx-table">
                <thead>
                  <tr className="tx-header-row">
                    <th>Date</th>
                    <th>Account</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 5).map((tx) => {
                    const matchedAcc = accounts.find(a => a.id === tx.accountId);
                    const isCredit = tx.amount < 0; // Negative amount means income/credit
                    return (
                      <tr key={tx.id} className="tx-row">
                        <td className="tx-date">{tx.date}</td>
                        <td style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                          {matchedAcc ? `${matchedAcc.institutionName} (${matchedAcc.name})` : 'Unknown Account'}
                        </td>
                        <td className="tx-merchant">
                          {tx.name}
                          {tx.isPending && <span className="tx-pending-badge">Pending</span>}
                        </td>
                        <td>
                          <span className="tx-category">{tx.category}</span>
                        </td>
                        <td className={`tx-amount ${isCredit ? 'credit' : 'debit'}`}>
                          {isCredit ? '+' : ''}{formatCurrency(Math.abs(tx.amount))}
                        </td>
                      </tr>
                    );
                  })}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                        No recent transactions synced.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

    </div>
  );
}
