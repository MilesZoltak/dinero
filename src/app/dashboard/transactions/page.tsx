'use client';

import React, { useEffect, useState } from 'react';
import { 
  Search, 
  Filter, 
  Plus, 
  Upload, 
  Trash2, 
  AlertCircle, 
  CheckCircle,
  FileSpreadsheet
} from 'lucide-react';

interface Account {
  id: string;
  name: string;
  institutionName: string;
  subtype: string;
  isManual: boolean;
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

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Filters state
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAccount, setFilterAccount] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterType, setFilterType] = useState('all'); // all, debit (expense), credit (income)

  // Single Manual Transaction Form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [txName, setTxName] = useState('');
  const [txAccountId, setTxAccountId] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().split('T')[0]);
  const [txCategory, setTxCategory] = useState('Food & Drink');
  const [txAmount, setTxAmount] = useState('');
  const [txType, setTxType] = useState('expense'); // expense (positive), income (negative)
  const [isSubmitting, setIsSubmitting] = useState(false);

  // CSV Import state
  const [showCsvForm, setShowCsvForm] = useState(false);
  const [csvAccountId, setCsvAccountId] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const [isParsingCsv, setIsParsingCsv] = useState(false);

  const loadData = async () => {
    try {
      const accountsRes = await fetch('/api/accounts');
      const accountsData = await accountsRes.json();
      setAccounts(accountsData.accounts || []);

      const transactionsRes = await fetch('/api/transactions');
      const transactionsData = await transactionsRes.json();
      setTransactions(transactionsData.transactions || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  // Add a single manual transaction
  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txName || !txAccountId || !txAmount) {
      showNotification('error', 'Please fill in merchant name, select an account, and enter an amount.');
      return;
    }

    setIsSubmitting(true);
    // Positive amount represents debit/expense, negative represents credit/income
    const adjustedAmount = txType === 'expense' ? parseFloat(txAmount) : -parseFloat(txAmount);

    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: txAccountId,
          name: txName,
          date: txDate,
          category: txCategory,
          amount: adjustedAmount,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showNotification('success', 'Transaction added successfully.');
        setTxName('');
        setTxAmount('');
        setShowAddForm(false);
        loadData();
      } else {
        showNotification('error', `Failed to add: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      showNotification('error', 'Error creating transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete transaction
  const handleDeleteTransaction = async (txId: string) => {
    if (!confirm('Are you sure you want to delete this transaction record?')) return;
    try {
      const res = await fetch(`/api/transactions?txId=${txId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showNotification('success', data.message);
        loadData();
      } else {
        showNotification('error', data.error);
      }
    } catch (err) {
      console.error(err);
      showNotification('error', 'Error deleting transaction.');
    }
  };

  // Parse CSV File
  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    setIsParsingCsv(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        // Split by lines, filtering empty lines
        const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
        if (lines.length < 2) {
          showNotification('error', 'CSV file is empty or missing data rows.');
          setIsParsingCsv(false);
          return;
        }

        // Header mapping helper
        // Standard expected column index mapping
        const headers = lines[0].toLowerCase().split(',').map(h => h.replace(/["']/g, '').trim());
        const dateIdx = headers.findIndex(h => h.includes('date'));
        const descIdx = headers.findIndex(h => h.includes('desc') || h.includes('name') || h.includes('payee') || h.includes('merchant'));
        const amountIdx = headers.findIndex(h => h.includes('amount') || h.includes('value') || h.includes('cost'));
        const catIdx = headers.findIndex(h => h.includes('cat'));

        if (dateIdx === -1 || descIdx === -1 || amountIdx === -1) {
          showNotification('error', 'Could not locate required headers in CSV. Headers must contain Date, Description, and Amount.');
          setIsParsingCsv(false);
          return;
        }

        const parsedRows: any[] = [];
        // Parse up to 100 rows for preview
        for (let i = 1; i < lines.length; i++) {
          const rowValues = lines[i].split(',').map(v => v.replace(/["']/g, '').trim());
          if (rowValues.length < Math.max(dateIdx, descIdx, amountIdx)) continue;

          const rawAmount = parseFloat(rowValues[amountIdx]);
          if (isNaN(rawAmount)) continue;

          parsedRows.push({
            date: rowValues[dateIdx],
            name: rowValues[descIdx],
            category: catIdx !== -1 && rowValues[catIdx] ? rowValues[catIdx] : 'Other',
            amount: rawAmount,
          });
        }

        setCsvPreview(parsedRows);
      } catch (err) {
        console.error(err);
        showNotification('error', 'Error reading CSV structure.');
      } finally {
        setIsParsingCsv(false);
      }
    };
    reader.readAsText(file);
  };

  // Upload parsed CSV transactions
  const handleUploadCsv = async () => {
    if (!csvAccountId || csvPreview.length === 0) {
      showNotification('error', 'Please select an account and select a valid CSV file.');
      return;
    }

    setIsParsingCsv(true);
    try {
      const txsWithAccount = csvPreview.map((tx) => ({
        ...tx,
        accountId: csvAccountId,
      }));

      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: txsWithAccount }),
      });
      const data = await res.json();
      if (data.success) {
        showNotification('success', `Imported ${data.count} transactions successfully!`);
        setCsvFile(null);
        setCsvPreview([]);
        setCsvAccountId('');
        setShowCsvForm(false);
        loadData();
      } else {
        showNotification('error', `Import failed: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      showNotification('error', 'Server error uploading CSV.');
    } finally {
      setIsParsingCsv(false);
    }
  };

  // Categories helper to extract unique categories dynamically
  const uniqueCategories = Array.from(
    new Set(transactions.map((tx) => tx.category).filter(Boolean))
  );

  // Apply filters
  const filteredTransactions = transactions.filter((tx) => {
    const matchesSearch = tx.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          tx.category.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesAccount = filterAccount === 'all' || tx.accountId === filterAccount;
    const matchesCategory = filterCategory === 'all' || tx.category === filterCategory;
    
    let matchesType = true;
    if (filterType === 'debit') {
      matchesType = tx.amount > 0; // debit/expense
    } else if (filterType === 'credit') {
      matchesType = tx.amount < 0; // credit/income
    }

    return matchesSearch && matchesAccount && matchesCategory && matchesType;
  });

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
        <span style={{ color: 'var(--text-secondary)' }}>Loading ledger data...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      
      {/* Header section */}
      <header className="dashboard-header">
        <div className="header-title-section">
          <h1>Transaction Ledger</h1>
          <p>Consolidated history of all cash flows and portfolios</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            className="btn btn-secondary" 
            onClick={() => { setShowCsvForm(!showCsvForm); setShowAddForm(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Upload size={16} />
            <span>CSV Import</span>
          </button>
          <button 
            className="btn btn-primary" 
            onClick={() => { setShowAddForm(!showAddForm); setShowCsvForm(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Plus size={18} />
            <span>Record Transaction</span>
          </button>
        </div>
      </header>

      {/* Notifications */}
      {notification && (
        <div 
          className="system-notification info" 
          style={{ 
            background: notification.type === 'success' ? 'var(--color-income-glow)' : 'var(--color-expense-glow)',
            borderColor: notification.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)',
            color: notification.type === 'success' ? '#a7f3d0' : '#fecdd3'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {notification.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            <span>{notification.message}</span>
          </div>
        </div>
      )}

      {/* Option 1: CSV Upload Interface Overlay */}
      {showCsvForm && (
        <div className="glass-panel" style={{ padding: '28px', maxWidth: '640px', margin: '0 auto', width: '100%' }}>
          <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileSpreadsheet style={{ color: '#34d399' }} />
            CSV Ledger Importer
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.5', marginBottom: '24px' }}>
            Import history logs to any manual account. Ensure your CSV file has header titles (e.g. <strong>Date, Description/Name, Amount</strong>). Amount values should be positive for expenses and negative for deposits.
          </p>

          <div className="form-group">
            <label className="form-label">Destination Manual Account</label>
            <select 
              className="input-field" 
              value={csvAccountId} 
              onChange={(e) => setCsvAccountId(e.target.value)}
              style={{ background: 'black' }}
              required
            >
              <option value="">-- Choose Manual Account --</option>
              {accounts.filter(a => a.isManual).map(a => (
                <option key={a.id} value={a.id}>{a.institutionName} - {a.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label className="form-label">Select File (.csv)</label>
            <input 
              type="file" 
              accept=".csv"
              className="input-field" 
              onChange={handleCsvFileChange}
              required
            />
          </div>

          {csvPreview.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--text-primary)' }}>
                Parsed Preview ({csvPreview.length} items detected)
              </h4>
              <div 
                className="glass-panel" 
                style={{ 
                  maxHeight: '180px', 
                  overflowY: 'auto', 
                  fontSize: '12px', 
                  padding: '12px', 
                  background: 'rgba(0,0,0,0.3)',
                  borderColor: 'rgba(255,255,255,0.03)'
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '6px' }}>Date</th>
                      <th style={{ padding: '6px' }}>Description</th>
                      <th style={{ padding: '6px', textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.slice(0, 5).map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '6px' }}>{row.date}</td>
                        <td style={{ padding: '6px', fontWeight: 600 }}>{row.name}</td>
                        <td style={{ padding: '6px', textAlign: 'right', color: row.amount < 0 ? 'var(--color-income)' : 'inherit' }}>
                          {formatCurrency(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {csvPreview.length > 5 && (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', marginTop: '6px' }}>
                    ... and {csvPreview.length - 5} more records.
                  </p>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              className="btn btn-secondary" 
              onClick={() => { setShowCsvForm(false); setCsvPreview([]); setCsvFile(null); }}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button 
              className="btn btn-primary" 
              onClick={handleUploadCsv}
              disabled={isParsingCsv || !csvAccountId || csvPreview.length === 0}
              style={{ flex: 1 }}
            >
              {isParsingCsv ? 'Importing Ledger...' : 'Confirm Import'}
            </button>
          </div>
        </div>
      )}

      {/* Option 2: Add Manual Transaction Form Interface */}
      {showAddForm && (
        <form className="glass-panel" style={{ padding: '28px', maxWidth: '640px', margin: '0 auto', width: '100%' }} onSubmit={handleAddTransaction}>
          <h3 style={{ marginBottom: '16px' }}>Record Manual Entry</h3>
          
          <div className="form-group">
            <label className="form-label">Merchant / Payee Name</label>
            <input 
              type="text" 
              className="input-field" 
              placeholder="e.g. Landlord Rent, Trader Joes, Paycheck" 
              value={txName}
              onChange={(e) => setTxName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Account Ledger</label>
            <select 
              className="input-field" 
              value={txAccountId} 
              onChange={(e) => setTxAccountId(e.target.value)}
              style={{ background: 'black' }}
              required
            >
              <option value="">-- Select Account Source --</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.institutionName} - {a.name} ({a.subtype})</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px' }}>
            <div className="form-group">
              <label className="form-label">Record Date</label>
              <input 
                type="date" 
                className="input-field" 
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Category</label>
              <select 
                className="input-field" 
                value={txCategory} 
                onChange={(e) => setTxCategory(e.target.value)}
                style={{ background: 'black' }}
              >
                <option value="Food & Drink">Food & Drink</option>
                <option value="Rent & Housing">Rent & Housing</option>
                <option value="Shopping">Shopping</option>
                <option value="Travel">Travel</option>
                <option value="Utilities">Utilities</option>
                <option value="Income">Income / Payroll</option>
                <option value="Investments">Investments</option>
                <option value="Other">Other / Misc</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px', marginBottom: '24px' }}>
            <div className="form-group">
              <label className="form-label">Value Amount ($)</label>
              <input 
                type="number" 
                step="0.01"
                className="input-field" 
                placeholder="0.00" 
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Direction</label>
              <select 
                className="input-field" 
                value={txType} 
                onChange={(e) => setTxType(e.target.value)}
                style={{ background: 'black' }}
              >
                <option value="expense">Expense (Debit)</option>
                <option value="income">Income / Deposit (Credit)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              type="button" 
              className="btn btn-secondary" 
              onClick={() => setShowAddForm(false)}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ flex: 1 }}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Recording...' : 'Save Transaction'}
            </button>
          </div>
        </form>
      )}

      {/* Filters ledger panel */}
      <section className="transactions-panel glass-panel">
        
        {/* Filter controls */}
        <div className="feed-controls">
          
          {/* Search bar */}
          <div style={{ position: 'relative' }}>
            <Search 
              size={18} 
              style={{ 
                position: 'absolute', 
                left: '14px', 
                top: '50%', 
                transform: 'translateY(-50%)', 
                color: 'var(--text-muted)' 
              }} 
            />
            <input 
              type="text" 
              className="input-field" 
              placeholder="Search description, payee, or category..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ paddingLeft: '44px' }}
            />
          </div>

          {/* Account selector filter */}
          <div>
            <select 
              className="input-field" 
              value={filterAccount} 
              onChange={(e) => setFilterAccount(e.target.value)}
              style={{ background: 'black' }}
            >
              <option value="all">All Accounts</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.institutionName} - {a.name}</option>
              ))}
            </select>
          </div>

          {/* Category filter */}
          <div>
            <select 
              className="input-field" 
              value={filterCategory} 
              onChange={(e) => setFilterCategory(e.target.value)}
              style={{ background: 'black' }}
            >
              <option value="all">All Categories</option>
              {uniqueCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

        </div>

        {/* Transaction records table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="tx-table">
            <thead>
              <tr className="tx-header-row">
                <th>Date</th>
                <th>Account</th>
                <th>Description</th>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                {/* Delete header column if user wants to delete records */}
                <th style={{ width: '60px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((tx) => {
                const matchedAcc = accounts.find(a => a.id === tx.accountId);
                const isCredit = tx.amount < 0;
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
                    <td className={`tx-amount ${isCredit ? 'credit' : 'debit'}`} style={{ fontWeight: 700 }}>
                      {isCredit ? '+' : ''}{formatCurrency(Math.abs(tx.amount))}
                    </td>
                    <td style={{ padding: '8px 16px', textAlign: 'right' }}>
                      {/* Let user delete manual records or mock inputs directly from dashboard */}
                      {tx.isManual && (
                        <button 
                          className="btn btn-danger" 
                          onClick={() => handleDeleteTransaction(tx.id)}
                          style={{ padding: '4px 6px', borderRadius: '4px' }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-secondary)' }}>
                    No matching transactions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
