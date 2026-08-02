'use client';

import React, { useEffect, useState } from 'react';
import { 
  TrendingDown, 
  TrendingUp, 
  ArrowLeftRight, 
  Tag, 
  Info, 
  CheckCircle, 
  AlertCircle, 
  Trash2, 
  Plus, 
  Settings,
  BarChart3,
  Wand2,
  RefreshCw,
  X,
  Sparkles,
  ArrowRight,
  RotateCcw
} from 'lucide-react';
import { Chart as ChartJS, registerables } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { STANDARD_CATEGORIES, CATEGORY_SUBCATEGORIES } from '@/lib/constants';
import { cleanMerchantName } from '@/lib/merchant';

ChartJS.register(...registerables);

interface Transaction {
  id: string;
  accountId: string;
  amount: number; // positive = debit/expense, negative = credit/income
  date: string;
  name: string;
  category: string;
  subcategory?: string;
}

interface CategoryRule {
  id: string;
  pattern: string;
  category: string;
}

export default function SpendHubPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Analytics states
  const [timeframe, setTimeframe] = useState<'30d' | '90d' | 'ytd' | 'all'>('30d');
  const [activeTab, setActiveTab] = useState<'overview' | 'rules'>('overview');
  
  // Drill-down states
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedCategoryType, setSelectedCategoryType] = useState<'spend' | 'income'>('spend');
  const [selectedMerchant, setSelectedMerchant] = useState<string | null>(null);
  const [drilldownTab, setDrilldownTab] = useState<'subcategories' | 'businesses'>('subcategories');
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  
  // Batch update states
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, string>>({});
  // { txId: { subcategory, applyToAll } }
  const [pendingSubcategoryUpdates, setPendingSubcategoryUpdates] = useState<Record<string, { subcategory: string; applyToAll: boolean }>>({});
  const [isSavingBatch, setIsSavingBatch] = useState(false);

  // Sort states for drill-down table
  const [sortColumn, setSortColumn] = useState<'date' | 'name' | 'amount' | 'category'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Notification state
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form states
  const [rulePattern, setRulePattern] = useState('');
  const [ruleCategory, setRuleCategory] = useState(STANDARD_CATEGORIES[0]);
  const [isSubmittingRule, setIsSubmittingRule] = useState(false);
  const [runningRetro, setRunningRetro] = useState(false);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const loadData = async () => {
    try {
      const txRes = await fetch('/api/transactions');
      const txData = await txRes.json();
      setTransactions(txData.transactions || []);

      const accountsRes = await fetch('/api/accounts');
      const accountsData = await accountsRes.json();
      setAccounts(accountsData.accounts || []);

      const ruleRes = await fetch('/api/categories/rules');
      const ruleData = await ruleRes.json();
      setRules(ruleData.rules || []);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSort = (column: 'date' | 'name' | 'amount' | 'category') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection(column === 'amount' || column === 'date' ? 'desc' : 'asc');
    }
  };

  // Filter transactions by selected timeframe
  const getFilteredTransactions = () => {
    const now = new Date();
    let thresholdDate = new Date();
    
    if (timeframe === '30d') {
      thresholdDate.setDate(now.getDate() - 30);
    } else if (timeframe === '90d') {
      thresholdDate.setDate(now.getDate() - 90);
    } else if (timeframe === 'ytd') {
      thresholdDate = new Date(now.getFullYear(), 0, 1);
    } else {
      return transactions;
    }

    const thresholdStr = thresholdDate.toISOString().split('T')[0];
    return transactions.filter(tx => tx.date >= thresholdStr);
  };

  const filteredTx = getFilteredTransactions();

  // Calculate metrics
  const totalSpend = filteredTx
    .filter(tx => tx.amount > 0 && tx.category !== 'Transfer')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalIncome = filteredTx
    .filter(tx => tx.amount < 0 && tx.category !== 'Transfer')
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  const netFlow = totalIncome - totalSpend;

  // Group spends by category (excluding neutral transfers)
  const categoryBreakdown = filteredTx
    .filter(tx => tx.amount > 0 && tx.category !== 'Transfer')
    .reduce((acc: { [key: string]: number }, tx) => {
      const cat = tx.category || 'Other';
      acc[cat] = (acc[cat] || 0) + tx.amount;
      return acc;
    }, {});

  // Group income by category (excluding neutral transfers)
  const incomeBreakdown = filteredTx
    .filter(tx => tx.amount < 0 && tx.category !== 'Transfer')
    .reduce((acc: { [key: string]: number }, tx) => {
      const cat = tx.category || 'Other';
      acc[cat] = (acc[cat] || 0) + Math.abs(tx.amount);
      return acc;
    }, {});

  // Add rule handler
  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rulePattern) return;

    setIsSubmittingRule(true);
    try {
      const res = await fetch('/api/categories/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: rulePattern, category: ruleCategory })
      });
      const data = await res.json();
      if (data.success) {
        showNotification('success', `Created matching rule for "${rulePattern}".`);
        setRulePattern('');
        loadData();
      } else {
        showNotification('error', data.error);
      }
    } catch (err) {
      console.error(err);
      showNotification('error', 'Error creating category rule.');
    } finally {
      setIsSubmittingRule(false);
    }
  };

  // Batch updates saver — handles both category and subcategory pending changes
  const handleSaveBatchUpdates = async () => {
    setIsSavingBatch(true);
    try {
      // Step 1: For applyToAll subcategory updates, create a vendor-level rule first
      const vendorRulePromises: Promise<any>[] = [];
      for (const [txId, update] of Object.entries(pendingSubcategoryUpdates)) {
        if (update.applyToAll) {
          const tx = sortedDrillDownTransactions.find(t => t.id === txId);
          if (tx && selectedCategory) {
            const vendor = cleanMerchantName(tx.name);
            vendorRulePromises.push(
              fetch('/api/categories/rules', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pattern: vendor, category: selectedCategory, subcategory: update.subcategory })
              })
            );
          }
        }
      }
      if (vendorRulePromises.length > 0) {
        await Promise.all(vendorRulePromises);
      }

      // Step 2: Save individual transaction overrides
      const allIds = new Set([...Object.keys(pendingUpdates), ...Object.keys(pendingSubcategoryUpdates)]);
      const updatesList = Array.from(allIds).map((id) => ({
        id,
        ...(pendingUpdates[id] ? { category: pendingUpdates[id] } : {}),
        ...(pendingSubcategoryUpdates[id] ? { subcategory: pendingSubcategoryUpdates[id].subcategory } : {})
      }));
      const res = await fetch('/api/transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: updatesList })
      });
      const data = await res.json();
      if (data.success) {
        // Step 3: If vendor rules were created, sweep retroactively
        if (vendorRulePromises.length > 0) {
          await fetch('/api/categories/retroactive', { method: 'POST' });
          showNotification('success', `Updated ${data.count} transaction(s) and applied vendor rule to all matching transactions.`);
        } else {
          showNotification('success', `Successfully updated ${data.count} transaction(s).`);
        }
        setPendingUpdates({});
        setPendingSubcategoryUpdates({});
        setSelectedMerchant(null);
        loadData();
      } else {
        showNotification('error', data.error);
      }
    } catch (err) {
      console.error(err);
      showNotification('error', 'Failed to save batch updates.');
    } finally {
      setIsSavingBatch(false);
    }
  };

  // Delete rule handler
  const handleDeleteRule = async (ruleId: string, pattern: string) => {
    if (!confirm(`Delete matching rule for keyword "${pattern}"?`)) return;

    try {
      const res = await fetch(`/api/categories/rules?ruleId=${ruleId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showNotification('success', 'Matching rule deleted successfully.');
        loadData();
      } else {
        showNotification('error', data.error);
      }
    } catch (err) {
      console.error(err);
      showNotification('error', 'Failed to delete rule.');
    }
  };

  // Run retroactive sweep manually
  const handleRunRetroactive = async () => {
    setRunningRetro(true);
    try {
      const res = await fetch('/api/categories/retroactive', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showNotification('success', data.message);
        loadData();
      } else {
        showNotification('error', data.error);
      }
    } catch (err) {
      console.error(err);
      showNotification('error', 'Retroactive sweep execution failed.');
    } finally {
      setRunningRetro(false);
    }
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
        <div className="animate-spin" style={{ width: '40px', height: '40px', border: '3px solid rgba(0,229,255,0.1)', borderTopColor: '#34d399', borderRadius: '50%' }}></div>
        <span style={{ color: 'var(--text-secondary)' }}>Analyzing transactions...</span>
      </div>
    );
  }

  // Sort categories by volume
  const sortedSpendCategories = Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]);
  const sortedIncomeCategories = Object.entries(incomeBreakdown).sort((a, b) => b[1] - a[1]);

  // Get transactions matching selected category drilldown
  const drillDownTransactions = filteredTx.filter((tx) => {
    const isOutflow = tx.amount > 0;
    const cat = tx.category || 'Other';
    if (selectedCategoryType === 'spend') {
      return isOutflow && cat === selectedCategory;
    } else {
      return !isOutflow && cat === selectedCategory;
    }
  });

  // Group drilldown transactions by cleaned business name to calculate business aggregates
  const businessBreakdown = drillDownTransactions.reduce((acc: { [key: string]: number }, tx) => {
    const biz = cleanMerchantName(tx.name);
    acc[biz] = (acc[biz] || 0) + Math.abs(tx.amount);
    return acc;
  }, {});
  const sortedBusinesses = Object.entries(businessBreakdown).sort((a, b) => b[1] - a[1]);

  // Group drilldown transactions by subcategory
  const subcategoryBreakdown = drillDownTransactions.reduce((acc: { [key: string]: number }, tx) => {
    const sub = tx.subcategory || 'Uncategorized';
    acc[sub] = (acc[sub] || 0) + Math.abs(tx.amount);
    return acc;
  }, {});
  const sortedSubcategories = Object.entries(subcategoryBreakdown).sort((a, b) => b[1] - a[1]);

  // Apply sub-filter based on the selected drilldown tab
  const filteredDrillDownTransactions = drilldownTab === 'subcategories'
    ? (selectedSubcategory ? drillDownTransactions.filter(tx => (tx.subcategory || 'Uncategorized') === selectedSubcategory) : drillDownTransactions)
    : (selectedMerchant ? drillDownTransactions.filter(tx => cleanMerchantName(tx.name) === selectedMerchant) : drillDownTransactions);

  // Sort constituents
  const sortedDrillDownTransactions = [...filteredDrillDownTransactions].sort((a, b) => {
    let valA: any = a[sortColumn];
    let valB: any = b[sortColumn];

    if (sortColumn === 'category') {
      valA = pendingUpdates[a.id] || a.category || '';
      valB = pendingUpdates[b.id] || b.category || '';
    }

    if (sortColumn === 'amount') {
      valA = Math.abs(a.amount);
      valB = Math.abs(b.amount);
    }

    if (typeof valA === 'string') {
      return sortDirection === 'asc' 
        ? valA.localeCompare(valB) 
        : valB.localeCompare(valA);
    } else {
      return sortDirection === 'asc'
        ? (valA > valB ? 1 : -1)
        : (valA < valB ? 1 : -1);
    }
  });

  // Chart configuration constants (Harmonized Organic Earth & Sage Palette matching Overview design)
  const spendColors = [
    '#e07a5f', /* Terracotta Earth */
    '#52796f', /* Forest Evergreen */
    '#d4a373', /* Sandstone Wood */
    '#7fb069', /* Sage Green */
    '#a3c9a8', /* Moss Green */
    '#b5838d', /* Muted Clay Rose */
    '#6b705c', /* Deep Olive */
  ];
  const incomeColors = [
    '#52796f', /* Forest Evergreen */
    '#7fb069', /* Sage Green */
    '#a3c9a8', /* Moss Green */
    '#d4a373', /* Sandstone Wood */
    '#ccd5ae', /* Pale Olive */
  ];

  const spendChartData = {
    labels: sortedSpendCategories.map(([cat]) => cat),
    datasets: [{
      data: sortedSpendCategories.map(([, amt]) => amt),
      backgroundColor: spendColors,
      borderColor: 'rgba(18, 22, 31, 0.9)',
      borderWidth: 2,
      hoverOffset: 8
    }]
  };

  const incomeChartData = {
    labels: sortedIncomeCategories.map(([cat]) => cat),
    datasets: [{
      data: sortedIncomeCategories.map(([, amt]) => amt),
      backgroundColor: incomeColors,
      borderColor: 'rgba(18, 22, 31, 0.9)',
      borderWidth: 2,
      hoverOffset: 8
    }]
  };

  const doughnutOptions = {
    cutout: '75%',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context: any) => ` ${context.label}: ${formatCurrency(context.raw)}`
        }
      }
    },
    maintainAspectRatio: false
  };

  const createDoughnutOptions = (categoriesList: [string, number][], type: 'spend' | 'income') => ({
    cutout: '75%',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context: any) => ` ${context.label}: ${formatCurrency(context.raw)}`
        }
      }
    },
    maintainAspectRatio: false,
    onClick: (event: any, elements: any[]) => {
      if (elements && elements.length > 0) {
        const index = elements[0].index !== undefined ? elements[0].index : elements[0]._index;
        if (index !== undefined) {
          const clickedCat = categoriesList[index]?.[0];
          if (clickedCat) {
            setSelectedCategory(clickedCat);
            setSelectedCategoryType(type);
            setSelectedMerchant(null);
            setSelectedSubcategory(null);
            setDrilldownTab('subcategories');
            setPendingUpdates({});
          }
        }
      }
    }
  });

  const createFilterDoughnutOptions = (onSelect: (item: string) => void, getItemName: (index: number) => string | undefined) => ({
    cutout: '75%',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context: any) => ` ${context.label}: ${formatCurrency(context.raw)}`
        }
      }
    },
    maintainAspectRatio: false,
    onClick: (event: any, elements: any[]) => {
      if (elements && elements.length > 0) {
        const index = elements[0].index !== undefined ? elements[0].index : elements[0]._index;
        if (index !== undefined) {
          const itemName = getItemName(index);
          if (itemName) {
            onSelect(itemName);
          }
        }
      }
    }
  });

  // Top 5 businesses for secondary Doughnut chart, group the rest
  const topBusinessesLimit = 5;
  const topBusinesses = sortedBusinesses.slice(0, topBusinessesLimit);
  const otherBusinessesSum = sortedBusinesses.slice(topBusinessesLimit).reduce((sum, [, amt]) => sum + amt, 0);

  const businessChartLabels = topBusinesses.map(([biz]) => biz);
  const businessChartDataPoints = topBusinesses.map(([, amt]) => amt);

  if (otherBusinessesSum > 0) {
    businessChartLabels.push('Other Businesses');
    businessChartDataPoints.push(otherBusinessesSum);
  }

  const businessChartColors = [
    '#e07a5f', /* Terracotta Earth */
    '#52796f', /* Forest Evergreen */
    '#d4a373', /* Sandstone Wood */
    '#7fb069', /* Sage Green */
    '#a3c9a8', /* Moss Green */
    '#b5838d', /* Muted Clay Rose */
    '#6b705c', /* Deep Olive */
  ];

  const businessChartData = {
    labels: businessChartLabels,
    datasets: [{
      data: businessChartDataPoints,
      backgroundColor: businessChartColors,
      borderColor: 'rgba(18, 22, 31, 0.9)',
      borderWidth: 2,
      hoverOffset: 8
    }]
  };

  // Subcategory chart colors and data
  const subcategoryChartColors = [
    '#52796f', /* Forest Evergreen */
    '#d4a373', /* Sandstone Wood */
    '#e07a5f', /* Terracotta Earth */
    '#7fb069', /* Sage Green */
    '#a3c9a8', /* Moss Green */
    '#b5838d', /* Muted Clay Rose */
    '#6b705c', /* Deep Olive */
  ];
  const subcategoryChartData = {
    labels: sortedSubcategories.map(([sub]) => sub),
    datasets: [{
      data: sortedSubcategories.map(([, amt]) => amt),
      backgroundColor: subcategoryChartColors,
      borderColor: 'rgba(18, 22, 31, 0.9)',
      borderWidth: 2,
      hoverOffset: 8
    }]
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', position: 'relative' }}>
      
      {/* Top Page Header */}
      <header className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.02em' }}>
            Spend Hub
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
            Analyze cash flow, identify recurring outflows, and optimize category classifications
          </p>
        </div>
        
        {/* Timeframe Selectors */}
        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.02)', padding: '4px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
          {(['30d', '90d', 'ytd', 'all'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTimeframe(t); setSelectedCategory(null); setSelectedMerchant(null); setPendingUpdates({}); }}
              style={{
                background: timeframe === t ? 'rgba(0, 229, 255, 0.08)' : 'transparent',
                border: 'none',
                color: timeframe === t ? '#34d399' : 'var(--text-secondary)',
                padding: '8px 16px',
                fontSize: '12px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600,
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
              {t === '30d' ? '30 Days' : t === '90d' ? '90 Days' : t === 'ytd' ? 'YTD' : 'All Time'}
            </button>
          ))}
        </div>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '2px' }}>
        <button
          onClick={() => setActiveTab('overview')}
          style={{
            background: 'none',
            border: 'none',
            color: activeTab === 'overview' ? '#34d399' : 'var(--text-secondary)',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer',
            padding: '10px 16px',
            borderBottom: activeTab === 'overview' ? '2px solid #34d399' : 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s ease'
          }}
        >
          <BarChart3 size={16} />
          Outflow Analytics
        </button>
        <button
          onClick={() => setActiveTab('rules')}
          style={{
            background: 'none',
            border: 'none',
            color: activeTab === 'rules' ? '#818cf8' : 'var(--text-secondary)',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer',
            padding: '10px 16px',
            borderBottom: activeTab === 'rules' ? '2px solid #818cf8' : 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s ease'
          }}
        >
          <Settings size={16} />
          Auto-Categorization Rules
        </button>
      </div>

      {/* Notifications */}
      {notification && (
        <div 
          className="system-notification info" 
          style={{ 
            background: notification.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.1)',
            borderColor: notification.type === 'success' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)',
            color: notification.type === 'success' ? '#a7f3d0' : '#fecdd3',
            zIndex: 99,
            borderRadius: '12px',
            backdropFilter: 'blur(10px)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {notification.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            <span>{notification.message}</span>
          </div>
        </div>
      )}

      {activeTab === 'overview' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          
          {/* Cash Flow Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                       {/* Total Expense card */}
            <div className="glass-panel" style={{ padding: '24px', position: 'relative', overflow: 'hidden', borderLeft: '3px solid #e07a5f' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 500 }}>Total Outflow (Spending)</span>
                  <h2 style={{ fontSize: '32px', fontWeight: 800, color: '#f4a261', marginTop: '8px', fontFamily: 'monospace' }}>
                    {formatCurrency(totalSpend)}
                  </h2>
                </div>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(224, 122, 95, 0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#e07a5f' }}>
                  <TrendingDown size={18} />
                </div>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px', display: 'block' }}>Excludes transfer flow and savings sweeps</span>
            </div>

            {/* Total Income card */}
            <div className="glass-panel" style={{ padding: '24px', position: 'relative', overflow: 'hidden', borderLeft: '3px solid #52796f' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 500 }}>Total Inflow (Deposits)</span>
                  <h2 style={{ fontSize: '32px', fontWeight: 800, color: '#a3c9a8', marginTop: '8px', fontFamily: 'monospace' }}>
                    {formatCurrency(totalIncome)}
                  </h2>
                </div>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(82, 121, 111, 0.12)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#7fb069' }}>
                  <TrendingUp size={18} />
                </div>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px', display: 'block' }}>Excludes investment transfers and internal adjustments</span>
            </div>

            {/* Net Savings card */}
            <div className="glass-panel" style={{ padding: '24px', position: 'relative', overflow: 'hidden', borderLeft: '3px solid #7fb069' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 500 }}>Net Cash Flow</span>
                  <h2 style={{ fontSize: '32px', fontWeight: 800, color: netFlow >= 0 ? '#7fb069' : '#f4a261', marginTop: '8px', fontFamily: 'monospace' }}>
                    {netFlow >= 0 ? '+' : ''}{formatCurrency(netFlow)}
                  </h2>
                </div>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: netFlow >= 0 ? 'rgba(127, 176, 105, 0.12)' : 'rgba(224, 122, 95, 0.12)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: netFlow >= 0 ? '#7fb069' : '#e07a5f' }}>
                  <ArrowLeftRight size={18} />
                </div>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px', display: 'block' }}>
                {netFlow >= 0 ? 'Accumulated surplus (Savings growth)' : 'Net deficit (Spending exceeds inflow)'}
              </span>
            </div>

          </div>

          {/* Cash Flow Balance Visualizer */}
          <div className="glass-panel" style={{ padding: '24px', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Inflow vs. Outflow Ratio</span>
            </h3>
            
            {totalIncome === 0 && totalSpend === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No cash flow data available for this timeframe.</p>
            ) : (
              <div>
                {/* Ratio bar */}
                <div style={{ width: '100%', height: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', overflow: 'hidden', display: 'flex' }}>
                  <div 
                    style={{ 
                      width: `${totalIncome + totalSpend > 0 ? (totalIncome / (totalIncome + totalSpend)) * 100 : 50}%`, 
                      background: '#7fb069',
                      transition: 'width 0.5s ease-out' 
                    }} 
                  />
                  <div 
                    style={{ 
                      width: `${totalIncome + totalSpend > 0 ? (totalSpend / (totalIncome + totalSpend)) * 100 : 50}%`, 
                      background: '#e07a5f',
                      transition: 'width 0.5s ease-out' 
                    }} 
                  />
                </div>
                {/* Ratio legend */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '10px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#7fb069', fontWeight: 600 }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#7fb069' }} />
                    Inflow: {((totalIncome / (totalIncome + totalSpend)) * 100).toFixed(0)}%
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#e07a5f', fontWeight: 600 }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#e07a5f' }} />
                    Outflow: {((totalSpend / (totalIncome + totalSpend)) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Grid for Spending Distribution */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '32px' }}>
            
            {/* Outflow Breakdown */}
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                <TrendingDown size={16} style={{ color: '#e07a5f' }} />
                Outflow Distribution
              </h3>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '24px' }}>
                Click a category below to view and filter transaction list details.
              </p>

              {sortedSpendCategories.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                  No spending recorded in this timeframe.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr', gap: '24px', alignItems: 'center' }}>
                  {/* Doughnut Chart */}
                  <div style={{ height: '180px', position: 'relative', cursor: 'pointer' }}>
                    <Doughnut data={spendChartData} options={createDoughnutOptions(sortedSpendCategories, 'spend')} />
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Spend</span>
                      <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                        {formatCurrency(totalSpend)}
                      </span>
                    </div>
                  </div>

                  {/* List breakdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {sortedSpendCategories.map(([cat, amt], idx) => {
                      const pct = ((amt / totalSpend) * 100).toFixed(0);
                      const isSelected = selectedCategory === cat && selectedCategoryType === 'spend';
                      const color = spendColors[idx % spendColors.length];
                      return (
                        <button 
                          key={cat} 
                          onClick={() => { 
                            setSelectedCategory(cat); 
                            setSelectedCategoryType('spend');
                            setSelectedMerchant(null);
                            setSelectedSubcategory(null);
                            setDrilldownTab('subcategories');
                            setPendingUpdates({});
                          }}
                          style={{ 
                            display: 'flex', 
                            flexDirection: 'column', 
                            gap: '6px', 
                            width: '100%', 
                            background: isSelected ? 'rgba(224, 122, 95, 0.08)' : 'rgba(255,255,255,0.01)', 
                            border: '1px solid',
                            borderColor: isSelected ? 'rgba(224, 122, 95, 0.25)' : 'rgba(255,255,255,0.03)',
                            padding: '10px 14px', 
                            borderRadius: '10px', 
                            textAlign: 'left',
                            cursor: 'pointer',
                            outline: 'none',
                            transition: 'all 0.15s ease'
                          }}
                          className="category-drill-btn"
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', width: '100%' }}>
                            <span style={{ color: isSelected ? '#f4a261' : 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color }} />
                              {cat}
                            </span>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'monospace' }}>
                              {formatCurrency(amt)} <span style={{ color: 'var(--text-muted)', fontSize: '9px', fontWeight: 400 }}>({pct}%)</span>
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Inflow Breakdown */}
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                <TrendingUp size={16} style={{ color: '#7fb069' }} />
                Inflow Distribution
              </h3>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '24px' }}>
                Click a category below to audit salary or transfer deposit records.
              </p>

              {sortedIncomeCategories.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                  No income recorded in this timeframe.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr', gap: '24px', alignItems: 'center' }}>
                  {/* Doughnut Chart */}
                  <div style={{ height: '180px', position: 'relative', cursor: 'pointer' }}>
                    <Doughnut data={incomeChartData} options={createDoughnutOptions(sortedIncomeCategories, 'income')} />
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Inflow</span>
                      <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                        {formatCurrency(totalIncome)}
                      </span>
                    </div>
                  </div>

                  {/* List breakdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {sortedIncomeCategories.map(([cat, amt], idx) => {
                      const pct = ((amt / totalIncome) * 100).toFixed(0);
                      const isSelected = selectedCategory === cat && selectedCategoryType === 'income';
                      const color = incomeColors[idx % incomeColors.length];
                      return (
                        <button 
                          key={cat} 
                          onClick={() => { 
                            setSelectedCategory(cat); 
                            setSelectedCategoryType('income');
                            setSelectedMerchant(null);
                            setSelectedSubcategory(null);
                            setDrilldownTab('subcategories');
                            setPendingUpdates({});
                          }}
                          style={{ 
                            display: 'flex', 
                            flexDirection: 'column', 
                            gap: '6px', 
                            width: '100%', 
                            background: isSelected ? 'rgba(16, 185, 129, 0.04)' : 'rgba(255,255,255,0.01)', 
                            border: '1px solid',
                            borderColor: isSelected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.03)',
                            padding: '10px 14px', 
                            borderRadius: '10px', 
                            textAlign: 'left',
                            cursor: 'pointer',
                            outline: 'none',
                            transition: 'all 0.15s ease'
                          }}
                          className="category-drill-btn"
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', width: '100%' }}>
                            <span style={{ color: isSelected ? '#a7f3d0' : 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color }} />
                              {cat}
                            </span>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'monospace' }}>
                              {formatCurrency(amt)} <span style={{ color: 'var(--text-muted)', fontSize: '9px', fontWeight: 400 }}>({pct}%)</span>
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Drill-down transactions details drawer (renders below when category clicked) */}
          {selectedCategory && (
            <div 
              className="glass-panel animated-fade-in" 
              style={{ 
                padding: '28px', 
                borderLeft: selectedCategoryType === 'spend' ? '4px solid #e07a5f' : '4px solid #52796f',
                boxShadow: selectedCategoryType === 'spend' ? '0 8px 32px -8px rgba(224,122,95,0.12)' : '0 8px 32px -8px rgba(82,121,111,0.12)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                <div>
                  <h3 style={{ fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-primary)' }}>
                    <span>Constituent Transactions</span>
                    <span style={{ 
                      color: selectedCategoryType === 'spend' ? '#f4a261' : '#a3c9a8', 
                      background: selectedCategoryType === 'spend' ? 'rgba(224,122,95,0.1)' : 'rgba(82,121,111,0.12)',
                      padding: '4px 12px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      fontWeight: 700
                    }}>
                      {selectedCategory}
                    </span>
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
                    Select a business filter capsule below, or click headers to sort transaction details.
                  </p>
                </div>
                 <button 
                  onClick={() => { 
                    setSelectedCategory(null); 
                    setSelectedMerchant(null); 
                    setSelectedSubcategory(null);
                    setPendingUpdates({}); 
                  }}
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px', borderRadius: '50%' }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Sub-filter Tabs: Subcategories vs Businesses */}
              <div style={{ marginBottom: '28px' }}>
                {/* Tab toggle */}
                <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.02)', padding: '4px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '20px', width: 'fit-content' }}>
                  <button
                    onClick={() => { setDrilldownTab('subcategories'); setSelectedSubcategory(null); setSelectedMerchant(null); }}
                    style={{
                      background: drilldownTab === 'subcategories' ? 'rgba(212, 163, 115, 0.14)' : 'transparent',
                      border: 'none',
                      color: drilldownTab === 'subcategories' ? '#d4a373' : 'var(--text-secondary)',
                      padding: '6px 16px',
                      fontSize: '12px',
                      borderRadius: '7px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    Subcategories
                  </button>
                  <button
                    onClick={() => { setDrilldownTab('businesses'); setSelectedSubcategory(null); setSelectedMerchant(null); }}
                    style={{
                      background: drilldownTab === 'businesses' ? 'rgba(127, 176, 105, 0.14)' : 'transparent',
                      border: 'none',
                      color: drilldownTab === 'businesses' ? '#7fb069' : 'var(--text-secondary)',
                      padding: '6px 16px',
                      fontSize: '12px',
                      borderRadius: '7px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    Businesses
                  </button>
                </div>

                {drilldownTab === 'subcategories' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr', gap: '24px', alignItems: 'center' }}>
                    {/* Subcategory Doughnut Chart */}
                    <div style={{ height: '200px', position: 'relative', cursor: 'pointer' }}>
                      {sortedSubcategories.length > 0 ? (
                        <>
                          <Doughnut 
                            data={subcategoryChartData} 
                            options={createFilterDoughnutOptions(
                              (sub) => setSelectedSubcategory(selectedSubcategory === sub ? null : sub),
                              (index) => sortedSubcategories[index]?.[0]
                            )} 
                          />
                          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <span style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total</span>
                            <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                              {formatCurrency(drillDownTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0))}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '12px' }}>
                          No data yet — run a retroactive sweep to classify subcategories.
                        </div>
                      )}
                    </div>

                    {/* Subcategory filter list */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto', paddingRight: '8px' }}>
                      <button
                        onClick={() => setSelectedSubcategory(null)}
                        style={{
                          padding: '8px 12px', fontSize: '12px', borderRadius: '8px', cursor: 'pointer',
                          border: '1px solid', borderColor: selectedSubcategory === null ? '#d4a373' : 'rgba(255,255,255,0.03)',
                          background: selectedSubcategory === null ? 'rgba(212,163,115,0.12)' : 'rgba(255,255,255,0.01)',
                          color: selectedSubcategory === null ? '#d4a373' : 'var(--text-secondary)',
                          fontWeight: 600, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.15s ease'
                        }}
                      >
                        <span>All Subcategories</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>({drillDownTransactions.length})</span>
                      </button>

                      {sortedSubcategories.map(([sub, total], idx) => {
                        const isSelected = selectedSubcategory === sub;
                        const count = drillDownTransactions.filter(tx => (tx.subcategory || 'Uncategorized') === sub).length;
                        const color = subcategoryChartColors[idx % subcategoryChartColors.length];
                        return (
                          <button
                            key={sub}
                            onClick={() => setSelectedSubcategory(isSelected ? null : sub)}
                            style={{
                              padding: '8px 12px', fontSize: '12px', borderRadius: '8px', cursor: 'pointer',
                              border: '1px solid', borderColor: isSelected ? '#d4a373' : 'rgba(255,255,255,0.03)',
                              background: isSelected ? 'rgba(212,163,115,0.12)' : 'rgba(255,255,255,0.01)',
                              color: isSelected ? '#d4a373' : 'var(--text-secondary)',
                              fontWeight: 600, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.15s ease'
                            }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color }} />
                              {sub}
                            </span>
                            <span style={{ fontSize: '10px', fontFamily: 'monospace', color: isSelected ? '#d4a373' : 'var(--text-muted)' }}>
                              {formatCurrency(total)} ({count})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr', gap: '24px', alignItems: 'center' }}>
                    {/* Business Doughnut Chart */}
                    <div style={{ height: '200px', position: 'relative', cursor: 'pointer' }}>
                      <Doughnut 
                        data={businessChartData} 
                        options={createFilterDoughnutOptions(
                          (biz) => setSelectedMerchant(selectedMerchant === biz ? null : biz),
                          (index) => businessChartLabels[index]
                        )} 
                      />
                      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total</span>
                        <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                          {formatCurrency(drillDownTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0))}
                        </span>
                      </div>
                    </div>

                    {/* Business filter list */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto', paddingRight: '8px' }}>
                      <button
                        onClick={() => setSelectedMerchant(null)}
                        style={{
                          padding: '8px 12px', fontSize: '12px', borderRadius: '8px', cursor: 'pointer',
                          border: '1px solid', borderColor: selectedMerchant === null ? '#7fb069' : 'rgba(255,255,255,0.03)',
                          background: selectedMerchant === null ? 'rgba(127,176,105,0.12)' : 'rgba(255,255,255,0.01)',
                          color: selectedMerchant === null ? '#7fb069' : 'var(--text-secondary)',
                          fontWeight: 600, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.15s ease'
                        }}
                      >
                        <span>All Businesses</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>({drillDownTransactions.length})</span>
                      </button>

                      {sortedBusinesses.map(([biz, total], idx) => {
                        const isSelected = selectedMerchant === biz;
                        const count = drillDownTransactions.filter(tx => cleanMerchantName(tx.name) === biz).length;
                        const color = idx < topBusinessesLimit ? businessChartColors[idx] : '#555';
                        return (
                          <button
                            key={biz}
                            onClick={() => setSelectedMerchant(isSelected ? null : biz)}
                            style={{
                              padding: '8px 12px', fontSize: '12px', borderRadius: '8px', cursor: 'pointer',
                              border: '1px solid', borderColor: isSelected ? '#7fb069' : 'rgba(255,255,255,0.03)',
                              background: isSelected ? 'rgba(127,176,105,0.12)' : 'rgba(255,255,255,0.01)',
                              color: isSelected ? '#7fb069' : 'var(--text-secondary)',
                              fontWeight: 600, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.15s ease'
                            }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color }} />
                              {biz}
                            </span>
                            <span style={{ fontSize: '10px', fontFamily: 'monospace', color: isSelected ? '#7fb069' : 'var(--text-muted)' }}>
                              {formatCurrency(total)} ({count})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>


              {/* Clickable Header Sorting Bar */}
              <div 
                style={{ 
                  display: 'flex', 
                  padding: '12px 20px', 
                  borderBottom: '1px solid rgba(255,255,255,0.06)', 
                  fontSize: '11px', 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.08em', 
                  color: 'var(--text-muted)', 
                  fontWeight: 600,
                  gap: '20px'
                }}
              >
                <div 
                  onClick={() => handleSort('date')}
                  style={{ width: '100px', cursor: 'pointer', userSelect: 'none', color: sortColumn === 'date' ? '#7fb069' : 'inherit' }}
                >
                  Date {sortColumn === 'date' && (sortDirection === 'asc' ? '▲' : '▼')}
                </div>
                <div 
                  onClick={() => handleSort('name')}
                  style={{ flex: 1, cursor: 'pointer', userSelect: 'none', color: sortColumn === 'name' ? '#7fb069' : 'inherit' }}
                >
                  Payee / Originating Account {sortColumn === 'name' && (sortDirection === 'asc' ? '▲' : '▼')}
                </div>
                <div 
                  onClick={() => handleSort('amount')}
                  style={{ width: '120px', textAlign: 'right', cursor: 'pointer', userSelect: 'none', color: sortColumn === 'amount' ? '#7fb069' : 'inherit' }}
                >
                  Amount {sortColumn === 'amount' && (sortDirection === 'asc' ? '▲' : '▼')}
                </div>
                <div 
                  onClick={() => handleSort('category')}
                  style={{ width: '340px', paddingLeft: '24px', cursor: 'pointer', userSelect: 'none', color: sortColumn === 'category' ? '#7fb069' : 'inherit' }}
                >
                  Classify (One-Click) {sortColumn === 'category' && (sortDirection === 'asc' ? '▲' : '▼')}
                </div>
              </div>

              {/* Transactions stream list container */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                {sortedDrillDownTransactions.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '13px' }}>
                    No constituent records match current criteria.
                  </div>
                ) : (
                  sortedDrillDownTransactions.map((tx) => {
                    const pendingCategory = pendingUpdates[tx.id];
                    const isPending = pendingCategory !== undefined;
                    const activeCategory = isPending ? pendingCategory : tx.category;

                    const matchedAcc = accounts.find(a => a.id === tx.accountId);
                    const accountLabel = matchedAcc ? `${matchedAcc.institutionName} (${matchedAcc.name})` : 'Unknown Account';

                    // When drilling down into a category, classify by subcategory instead of top-level category
                    const pendingSubEntry = pendingSubcategoryUpdates[tx.id];
                    const isSubPending = pendingSubEntry !== undefined;
                    const activeSubcategory = isSubPending ? pendingSubEntry.subcategory : (tx.subcategory || '');
                    const subcategoryOptions = selectedCategory ? (CATEGORY_SUBCATEGORIES[selectedCategory] || []) : [];

                    return (
                      <div 
                        key={tx.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '14px 20px',
                          background: isSubPending ? 'rgba(124, 77, 255, 0.03)' : 'rgba(255,255,255,0.01)',
                          border: '1px solid',
                          borderColor: isSubPending ? 'rgba(124,77,255,0.2)' : 'rgba(255,255,255,0.03)',
                          borderRadius: '12px',
                          gap: '20px',
                          transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                        className="tx-stream-card"
                      >
                        {/* Date field */}
                        <div style={{ width: '100px', fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                          {tx.date}
                        </div>

                        {/* Payee + Account */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {tx.name}
                            </span>
                            {isSubPending && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ 
                                  padding: '2px 8px', 
                                  background: 'rgba(124, 77, 255, 0.1)', 
                                  border: '1px solid rgba(124, 77, 255, 0.3)', 
                                  color: '#b39ddb',
                                  fontSize: '9px',
                                  borderRadius: '10px',
                                  textTransform: 'uppercase',
                                  fontWeight: 700
                                }}>
                                  Subcategory ➔ {pendingSubEntry.subcategory}
                                </span>
                                {/* Apply-to-all toggle */}
                                <button
                                  onClick={() => {
                                    setPendingSubcategoryUpdates(prev => ({
                                      ...prev,
                                      [tx.id]: { ...prev[tx.id], applyToAll: !prev[tx.id].applyToAll }
                                    }));
                                  }}
                                  style={{
                                    fontSize: '9px',
                                    padding: '2px 8px',
                                    borderRadius: '10px',
                                    border: '1px solid',
                                    cursor: 'pointer',
                                    background: pendingSubEntry.applyToAll ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.03)',
                                    borderColor: pendingSubEntry.applyToAll ? 'rgba(0,229,255,0.3)' : 'rgba(255,255,255,0.08)',
                                    color: pendingSubEntry.applyToAll ? '#34d399' : 'var(--text-muted)',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    transition: 'all 0.15s ease'
                                  }}
                                  title={pendingSubEntry.applyToAll ? 'Will create a vendor rule for all matching transactions' : 'One-off: only this transaction'}
                                >
                                  {pendingSubEntry.applyToAll ? '⚡ All' : 'One-off'}
                                </button>
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span style={{ 
                              fontSize: '10px', 
                              background: 'rgba(255,255,255,0.04)', 
                              border: '1px solid rgba(255,255,255,0.04)', 
                              padding: '2px 8px', 
                              borderRadius: '12px', 
                              color: 'var(--text-muted)' 
                            }}>
                              {accountLabel}
                            </span>
                            {tx.subcategory && (
                              <span style={{ 
                                fontSize: '10px', 
                                background: 'rgba(124,77,255,0.08)', 
                                border: '1px solid rgba(124,77,255,0.15)', 
                                padding: '2px 8px', 
                                borderRadius: '12px', 
                                color: '#b39ddb',
                                fontWeight: 600
                              }}>
                                {tx.subcategory}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Amount */}
                        <div style={{ width: '120px', textAlign: 'right', fontSize: '15px', fontWeight: 700, fontFamily: 'monospace', color: selectedCategoryType === 'spend' ? '#ffb3c1' : '#a7f3d0' }}>
                          {formatCurrency(Math.abs(tx.amount))}
                        </div>

                        {/* Quick Subcategory Classify Pills */}
                        <div style={{ width: '380px', paddingLeft: '24px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          {subcategoryOptions.map((sub) => {
                            const isSelected = activeSubcategory === sub;
                            return (
                              <button
                                key={sub}
                                type="button"
                                onClick={() => {
                                  if (tx.subcategory === sub && !isSubPending) return; // already saved
                                  if (pendingSubcategoryUpdates[tx.id]?.subcategory === sub) {
                                    // deselect
                                    const next = { ...pendingSubcategoryUpdates };
                                    delete next[tx.id];
                                    setPendingSubcategoryUpdates(next);
                                  } else {
                                    setPendingSubcategoryUpdates(prev => ({
                                      ...prev,
                                      [tx.id]: { subcategory: sub, applyToAll: true } // default: apply to all
                                    }));
                                  }
                                }}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: '11px',
                                  borderRadius: '16px',
                                  cursor: 'pointer',
                                  border: '1px solid',
                                  borderColor: isSelected
                                    ? (isSubPending && pendingSubEntry?.subcategory === sub ? 'rgba(124,77,255,0.5)' : 'rgba(124,77,255,0.3)')
                                    : 'rgba(255,255,255,0.04)',
                                  background: isSelected
                                    ? (isSubPending && pendingSubEntry?.subcategory === sub ? 'rgba(124,77,255,0.15)' : 'rgba(124,77,255,0.06)')
                                    : 'rgba(255,255,255,0.01)',
                                  color: isSelected
                                    ? (isSubPending && pendingSubEntry?.subcategory === sub ? '#ce93d8' : '#b39ddb')
                                    : 'var(--text-muted)',
                                  fontWeight: isSelected ? 700 : 500,
                                  transition: 'all 0.15s ease',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {sub}
                              </button>
                            );
                          })}

                          {/* Reset Button */}
                          {isPending && (
                            <button 
                              onClick={() => {
                                const next = { ...pendingUpdates };
                                delete next[tx.id];
                                setPendingUpdates(next);
                              }}
                              style={{ 
                                background: 'none', 
                                border: 'none', 
                                color: 'var(--text-muted)', 
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                marginLeft: '8px'
                              }}
                              title="Reset Change"
                            >
                              <RotateCcw size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Floating Batch Save Panel */}
              {(Object.keys(pendingUpdates).length > 0 || Object.keys(pendingSubcategoryUpdates).length > 0) && (() => {
                const catCount = Object.keys(pendingUpdates).length;
                const subCount = Object.keys(pendingSubcategoryUpdates).length;
                const allCount = new Set([...Object.keys(pendingUpdates), ...Object.keys(pendingSubcategoryUpdates)]).size;
                const hasVendorRules = Object.values(pendingSubcategoryUpdates).some(u => u.applyToAll);
                return (
                  <div 
                    className="animated-fade-in"
                    style={{
                      marginTop: '28px',
                      padding: '16px 28px',
                      background: 'rgba(0,0,0,0.6)',
                      border: '1px solid rgba(124,77,255,0.2)',
                      borderRadius: '16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      backdropFilter: 'blur(16px)',
                      boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)'
                    }}
                  >
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <div>
                        ⚡ <strong style={{ color: '#b39ddb' }}>{allCount}</strong> transaction{allCount !== 1 ? 's' : ''} pending
                        {catCount > 0 && <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>({catCount} category{catCount !== 1 ? '' : ''})</span>}
                        {subCount > 0 && <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>({subCount} subcategory)</span>}
                      </div>
                      {hasVendorRules && (
                        <div style={{ fontSize: '11px', color: '#34d399' }}>
                          ⚡ Will create vendor rules and sweep all matching transactions
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button 
                        onClick={() => { setPendingUpdates({}); setPendingSubcategoryUpdates({}); }}
                        className="btn btn-secondary"
                        style={{ padding: '8px 18px', fontSize: '12px', borderRadius: '8px' }}
                      >
                        Discard
                      </button>
                      <button 
                        onClick={handleSaveBatchUpdates}
                        disabled={isSavingBatch}
                        className="btn btn-primary"
                        style={{ 
                          padding: '8px 24px', 
                          fontSize: '12px', 
                          borderRadius: '8px',
                          background: 'linear-gradient(135deg, #818cf8 0%, #34d399 100%)',
                          boxShadow: '0 0 16px rgba(124, 77, 255, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                      >
                        {isSavingBatch ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                        Save All Changes
                      </button>
                    </div>
                  </div>
                );
              })()}

            </div>
          )}

        </div>
      ) : (
        /* Auto-Categorization rules settings tab */
        <div className="accounts-section">
          
          {/* Left Panel: Rules List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="account-group-title">Active Match Rules</h3>
              <button 
                onClick={handleRunRetroactive}
                disabled={runningRetro || rules.length === 0}
                className="btn btn-secondary"
                style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {runningRetro ? <RefreshCw size={12} className="animate-spin" /> : <Wand2 size={12} />}
                <span>Sweep Transactions</span>
              </button>
            </div>
            
            <div className="system-notification info" style={{ background: 'rgba(124, 77, 255, 0.05)', borderColor: 'rgba(124, 77, 255, 0.15)', marginTop: '-8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Seeded keywords evaluate automatically during sync. Modify keywords here to automatically isolate non-spend flow elements like taxes, transfers, and salaries from your Outflow Distribution.
              </span>
            </div>
            
            {rules.length === 0 ? (
              <div className="glass-panel" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No categorization rules found.
              </div>
            ) : (
              <div className="glass-panel" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {rules.map((rule) => (
                    <div 
                      key={rule.id} 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        padding: '12px 0',
                        borderBottom: '1px solid rgba(255,255,255,0.02)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div className="account-icon" style={{ background: 'rgba(124, 77, 255, 0.05)', color: '#818cf8' }}>
                          <Tag size={16} />
                        </div>
                        <div>
                          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                            If description contains <strong style={{ color: 'white', fontFamily: 'monospace', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>{rule.pattern}</strong>
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            Categorize as: <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{rule.category}</span>
                          </div>
                        </div>
                      </div>
                      
                      <button 
                        className="btn btn-danger" 
                        onClick={() => handleDeleteRule(rule.id, rule.pattern)}
                        style={{ padding: '6px 8px' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel: Create Rule Form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <h3 className="account-group-title">Create Match Rule</h3>
            
            <form className="glass-panel" style={{ padding: '24px' }} onSubmit={handleAddRule}>
              <div className="form-group">
                <label className="form-label">Keyword / Substring Match</label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="e.g. transfer, payroll, refund" 
                  value={rulePattern}
                  onChange={(e) => setRulePattern(e.target.value)}
                  required
                />
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                  Matches case-insensitively against bank transaction memos.
                </span>
              </div>

              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label className="form-label">Target Category</label>
                <select 
                  className="input-field" 
                  value={ruleCategory} 
                  onChange={(e) => setRuleCategory(e.target.value)}
                  style={{ background: 'black' }}
                >
                  {STANDARD_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{ width: '100%', background: 'linear-gradient(135deg, #818cf8 0%, #18a0fb 100%)', boxShadow: 'none' }}
                disabled={isSubmittingRule}
              >
                {isSubmittingRule ? 'Creating Rule...' : 'Save Rule'}
              </button>
            </form>
          </div>

        </div>
      )}

    </div>
  );
}
