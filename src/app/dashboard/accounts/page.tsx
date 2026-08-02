'use client';

import React, { useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { 
  Plus, 
  Trash2, 
  CreditCard, 
  Building2, 
  AlertCircle, 
  CheckCircle,
  HelpCircle,
  TrendingUp,
  FileText,
  DollarSign,
  Briefcase,
  RefreshCw,
  Key
} from 'lucide-react';

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

// Child PlaidLinker component to mount when token is ready
interface PlaidLinkerProps {
  token: string;
  onSuccess: any;
  onExit: () => void;
}

function PlaidLinker({ token, onSuccess, onExit }: PlaidLinkerProps) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess,
    onExit,
  });

  useEffect(() => {
    if (ready && open) {
      open();
    }
  }, [ready, open]);

  return null;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [plaidToken, setPlaidToken] = useState<string | null>(null);
  const [isMockFlow, setIsMockFlow] = useState(false);
  const [linkTokenLoading, setLinkTokenLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Manual account form states
  const [manualName, setManualName] = useState('');
  const [manualInstitution, setManualInstitution] = useState('');
  const [manualType, setManualType] = useState('depository');
  const [manualSubtype, setManualSubtype] = useState('checking');
  const [manualBalance, setManualBalance] = useState('');
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);

  // SimpleFIN form states
  const [showSimpleFinModal, setShowSimpleFinModal] = useState(false);
  const [simpleFinToken, setSimpleFinToken] = useState('');
  const [isSubmittingSimpleFin, setIsSubmittingSimpleFin] = useState(false);

  // Modal toggles
  const [showMockModal, setShowMockModal] = useState(false);
  const [showLinkSelectorModal, setShowLinkSelectorModal] = useState(false);

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch (err) {
      console.error('Error fetching accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  // Get Link token on demand for the chosen Plaid account type
  const initiatePlaidLink = async (isInvestment: boolean) => {
    setShowLinkSelectorModal(false);
    setLinkTokenLoading(true);
    try {
      const res = await fetch('/api/plaid/create-link-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isInvestment }),
      });
      const data = await res.json();
      
      if (data.error) {
        showNotification('error', `Failed to initialize connection: ${data.error}`);
        return;
      }

      if (data.isMock) {
        setIsMockFlow(true);
        setPlaidToken(data.link_token);
        setShowMockModal(true); // Open simulated mock bank picker
      } else {
        setIsMockFlow(false);
        setPlaidToken(data.link_token); // Mounting <PlaidLinker> triggers Link automatically
      }
    } catch (err) {
      console.error('Failed to create Plaid Link Token:', err);
      showNotification('error', 'Failed to connect to Plaid servers.');
    } finally {
      setLinkTokenLoading(false);
    }
  };

  const handlePlaidSuccess = async (public_token: string, metadata: any) => {
    try {
      setLoading(true);
      const response = await fetch('/api/plaid/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_token,
          institution: metadata.institution,
          isMock: false
        }),
      });
      const data = await response.json();
      if (data.success) {
        showNotification('success', `Successfully linked ${metadata.institution?.name || 'your institution'}!`);
        fetchAccounts();
      } else {
        showNotification('error', `Failed to exchange token: ${data.error}`);
      }
    } catch (err) {
      console.error('Failed to exchange token:', err);
      showNotification('error', 'Token exchange failed. Please try again.');
    } finally {
      setPlaidToken(null);
      setLoading(false);
    }
  };

  // Mock exchange flow simulation
  const handleLinkMockBank = async (bankName: string, bankId: string) => {
    setShowMockModal(false);
    setPlaidToken(null);
    setLoading(true);
    try {
      const response = await fetch('/api/plaid/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_token: 'mock_token_' + Math.random().toString(36).substr(2, 9),
          institution: { name: bankName, institution_id: bankId },
          isMock: true,
        }),
      });
      const data = await response.json();
      if (data.success) {
        showNotification('success', `Simulated linkage of ${bankName} completed!`);
        fetchAccounts();
      } else {
        showNotification('error', 'Failed to link mock account');
      }
    } catch (err) {
      console.error(err);
      showNotification('error', 'Failed to simulate connection');
    } finally {
      setLoading(false);
    }
  };

  // Claim and Link SimpleFIN Bridge
  const handleLinkSimpleFin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simpleFinToken) {
      showNotification('error', 'Please enter a valid SimpleFIN setup token.');
      return;
    }

    setIsSubmittingSimpleFin(true);
    try {
      const res = await fetch('/api/simplefin/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupToken: simpleFinToken }),
      });
      const data = await res.json();
      if (data.success) {
        showNotification('success', 'SimpleFIN Bridge successfully connected!');
        setShowSimpleFinModal(false);
        setSimpleFinToken('');
        fetchAccounts();
      } else {
        showNotification('error', `Link failed: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      showNotification('error', 'Failed to connect SimpleFIN Bridge.');
    } finally {
      setIsSubmittingSimpleFin(false);
    }
  };

  // Handle adding manual account
  const handleAddManualAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualName || !manualBalance) {
      showNotification('error', 'Please fill in account name and balance.');
      return;
    }

    setIsSubmittingManual(true);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: manualName,
          institutionName: manualInstitution || 'Manual Asset',
          type: manualType,
          subtype: manualSubtype,
          balance: parseFloat(manualBalance),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showNotification('success', `Manual account "${manualName}" added.`);
        setManualName('');
        setManualInstitution('');
        setManualBalance('');
        fetchAccounts();
      } else {
        showNotification('error', `Failed: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      showNotification('error', 'Error adding manual account');
    } finally {
      setIsSubmittingManual(false);
    }
  };

  // Handle deleting/unlinking account
  const handleDeleteAccount = async (accountId: string, accountName: string) => {
    if (!confirm(`Are you sure you want to remove "${accountName}"? Connected credentials and historical transactions will be deleted.`)) {
      return;
    }
    
    try {
      const res = await fetch(`/api/accounts?accountId=${accountId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showNotification('success', data.message);
        fetchAccounts();
      } else {
        showNotification('error', data.error);
      }
    } catch (err) {
      console.error(err);
      showNotification('error', 'Error deleting account.');
    }
  };

  const plaidAccounts = accounts.filter((a) => !a.isManual);
  const manualAccounts = accounts.filter((a) => a.isManual);

  const groupedPlaidAccounts = plaidAccounts.reduce((acc, curr) => {
    if (!acc[curr.institutionName]) {
      acc[curr.institutionName] = [];
    }
    acc[curr.institutionName].push(curr);
    return acc;
  }, {} as Record<string, Account[]>);

  const handleTypeChange = (typeVal: string) => {
    setManualType(typeVal);
    if (typeVal === 'depository') setManualSubtype('checking');
    else if (typeVal === 'credit') setManualSubtype('credit card');
    else if (typeVal === 'investment') setManualSubtype('brokerage');
    else if (typeVal === 'loan') setManualSubtype('mortgage');
    else setManualSubtype('other');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      
      {/* Dynamic Plaid Linker mount */}
      {plaidToken && !isMockFlow && (
        <PlaidLinker 
          token={plaidToken} 
          onSuccess={handlePlaidSuccess} 
          onExit={() => setPlaidToken(null)} 
        />
      )}

      {/* Header section */}
      <header className="dashboard-header">
        <div className="header-title-section">
          <h1>Manage Integrations</h1>
          <p>Link automated bank feeds or manage manually tracked accounts</p>
        </div>
        <button 
          className="btn btn-primary" 
          onClick={() => setShowLinkSelectorModal(true)}
          disabled={linkTokenLoading}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          {linkTokenLoading ? <RefreshCw size={18} className="animate-spin" /> : <Plus size={18} />}
          <span>{linkTokenLoading ? 'Connecting...' : 'Connect Bank / Card'}</span>
        </button>
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

      {/* Accounts List and Forms split screen */}
      <div className="accounts-section">
        
        {/* Left Side: Display Linked and Manual Accounts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          
          {/* Section 1: Linked Accounts */}
          <div>
            <h3 className="account-group-title" style={{ marginBottom: '16px' }}>Linked Institutions (Automated)</h3>
            
            {Object.keys(groupedPlaidAccounts).length === 0 ? (
              <div className="glass-panel" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No active automated feeds. Click &quot;Connect Bank / Card&quot; to link your first institution.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {Object.entries(groupedPlaidAccounts).map(([instName, instAccounts]) => (
                  <div key={instName} className="glass-panel" style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Building2 size={20} style={{ color: '#34d399' }} />
                        <span style={{ fontWeight: 700, fontSize: '16px' }}>{instName}</span>
                      </div>
                      <button 
                        className="btn btn-danger" 
                        onClick={() => handleDeleteAccount(instAccounts[0].id, instName)}
                        style={{ padding: '6px 10px', fontSize: '12px' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="accounts-list">
                      {instAccounts.map((acc) => (
                        <div key={acc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '14px' }}>{acc.name}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                              {acc.subtype.toUpperCase()} {acc.mask ? `•••• ${acc.mask}` : ''}
                              {acc.itemId?.startsWith('sfin_') && <span style={{ color: '#10b981', fontSize: '10px', marginLeft: '6px' }}>SimpleFIN</span>}
                            </div>
                          </div>
                          <div style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: '15px' }}>
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(acc.balance)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Manual Accounts */}
          <div>
            <h3 className="account-group-title" style={{ marginBottom: '16px' }}>Manual Portfolio & Assets</h3>
            
            {manualAccounts.length === 0 ? (
              <div className="glass-panel" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No manual assets added yet. Use the form to add properties, 401(k)s, or cash balances.
              </div>
            ) : (
              <div className="glass-panel" style={{ padding: '20px' }}>
                <div className="accounts-list">
                  {manualAccounts.map((acc) => (
                    <div 
                      key={acc.id} 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        padding: '12px 0',
                        borderBottom: '1px solid rgba(255,255,255,0.02)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div className="account-icon">
                          <HelpCircle size={18} style={{ color: 'var(--accent-purple)' }} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '15px' }}>{acc.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {acc.institutionName} • {acc.subtype.toUpperCase()}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <span style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: '16px' }}>
                          {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(acc.balance)}
                        </span>
                        <button 
                          className="btn btn-danger" 
                          onClick={() => handleDeleteAccount(acc.id, acc.name)}
                          style={{ padding: '6px 8px' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Right Side: Add Manual Account Form */}
        <div>
          <h3 className="account-group-title" style={{ marginBottom: '16px' }}>Track Manual Account</h3>
          
          <form className="glass-panel" style={{ padding: '28px' }} onSubmit={handleAddManualAccount}>
            
            <div className="form-group">
              <label className="form-label">Account Name</label>
              <input 
                type="text" 
                className="input-field" 
                placeholder="e.g. Employer 401(k), Primary Home, Gold Bullion" 
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Institution / Host</label>
              <input 
                type="text" 
                className="input-field" 
                placeholder="e.g. Fidelity, Vanguard, Physical Asset" 
                value={manualInstitution}
                onChange={(e) => setManualInstitution(e.target.value)}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Classification</label>
                <select 
                  className="input-field" 
                  value={manualType} 
                  onChange={(e) => handleTypeChange(e.target.value)}
                  style={{ background: 'black' }}
                >
                  <option value="depository">Depository (Cash)</option>
                  <option value="investment">Investment (Portfolio)</option>
                  <option value="credit">Credit (Debt)</option>
                  <option value="loan">Loan (Liability)</option>
                  <option value="other">Other Asset</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Account Type</label>
                <select 
                  className="input-field" 
                  value={manualSubtype} 
                  onChange={(e) => setManualSubtype(e.target.value)}
                  style={{ background: 'black' }}
                >
                  {manualType === 'depository' && (
                    <>
                      <option value="checking">Checking</option>
                      <option value="savings">Savings / HYSA</option>
                      <option value="hsa">HSA (Health Savings)</option>
                    </>
                  )}
                  {manualType === 'investment' && (
                    <>
                      <option value="brokerage">Brokerage Account</option>
                      <option value="401k">401(k)</option>
                      <option value="ira">Roth / Traditional IRA</option>
                    </>
                  )}
                  {manualType === 'credit' && (
                    <option value="credit card">Credit Card</option>
                  )}
                  {manualType === 'loan' && (
                    <>
                      <option value="mortgage">Mortgage</option>
                      <option value="student">Student Loan</option>
                      <option value="auto">Auto Loan</option>
                    </>
                  )}
                  {manualType === 'other' && (
                    <>
                      <option value="property">Real Estate</option>
                      <option value="precious metal">Precious Metals</option>
                      <option value="cash">Physical Cash</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">Current Balance ($)</label>
              <input 
                type="number" 
                step="0.01"
                className="input-field" 
                placeholder="0.00" 
                value={manualBalance}
                onChange={(e) => setManualBalance(e.target.value)}
                required
              />
            </div>

            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ width: '100%' }}
              disabled={isSubmittingManual}
            >
              {isSubmittingManual ? 'Saving Account...' : 'Add Manual Account'}
            </button>
          </form>
        </div>

      </div>

      {/* Modal 1: Link Selector Modal (Choose Integration) */}
      {showLinkSelectorModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 99,
          backdropFilter: 'blur(8px)'
        }}>
          <div className="glass-panel" style={{ padding: '36px', maxWidth: '480px', width: '90%', borderColor: 'rgba(0,229,255,0.2)' }}>
            <h2 style={{ fontSize: '22px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Building2 style={{ color: '#34d399' }} />
              Choose Connection Type
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px', lineHeight: '1.5' }}>
              Select your integration method. You can link accounts using Plaid or claim a setup token from your SimpleFIN Bridge.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              
              {/* Plaid Transactions */}
              <button 
                className="btn btn-secondary" 
                onClick={() => initiatePlaidLink(false)}
                style={{ justifyContent: 'space-between', padding: '16px', textAlign: 'left' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <CreditCard style={{ color: 'var(--accent-cyan)' }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>Plaid: Standard Bank / Card</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Checking, Savings, Credit Cards</div>
                  </div>
                </div>
                <Plus size={16} />
              </button>
              
              {/* Plaid Investments */}
              <button 
                className="btn btn-secondary" 
                onClick={() => initiatePlaidLink(true)}
                style={{ justifyContent: 'space-between', padding: '16px', textAlign: 'left' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Briefcase style={{ color: 'var(--accent-purple)' }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>Plaid: Brokerage & Retirement</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>401(k), IRA, HSA, Portfolios</div>
                  </div>
                </div>
                <Plus size={16} />
              </button>

              {/* SimpleFIN Bridge */}
              <button 
                className="btn btn-secondary" 
                onClick={() => { setShowLinkSelectorModal(false); setShowSimpleFinModal(true); }}
                style={{ justifyContent: 'space-between', padding: '16px', textAlign: 'left' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Key style={{ color: '#10b981' }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>SimpleFIN Bridge (Instant)</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Link banks instantly using a setup token</div>
                  </div>
                </div>
                <Plus size={16} />
              </button>

            </div>
            
            <button 
              className="btn btn-danger" 
              onClick={() => setShowLinkSelectorModal(false)}
              style={{ width: '100%', marginTop: '24px' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Modal 2: SimpleFIN Setup Token Modal */}
      {showSimpleFinModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 100,
          backdropFilter: 'blur(8px)'
        }}>
          <div className="glass-panel" style={{ padding: '36px', maxWidth: '480px', width: '90%', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
            <h2 style={{ fontSize: '22px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Key style={{ color: '#10b981' }} />
              Link SimpleFIN Bridge
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px', lineHeight: '1.5' }}>
              Enter the Base64 **Setup Token** generated from your SimpleFIN Bridge dashboard. This token will be claimed to retrieve a secure, read-only data feed.
            </p>
            
            <form onSubmit={handleLinkSimpleFin}>
              <div className="form-group" style={{ marginBottom: '24px' }}>
                <label className="form-label">Setup Token</label>
                <textarea 
                  className="input-field" 
                  rows={4}
                  placeholder="Paste your setup token here (starts with a long base64 string...)" 
                  value={simpleFinToken}
                  onChange={(e) => setSimpleFinToken(e.target.value)}
                  style={{ resize: 'none', fontFamily: 'monospace', fontSize: '12px' }}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => { setShowSimpleFinModal(false); setSimpleFinToken(''); }}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  style={{ flex: 1, background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', boxShadow: 'none' }}
                  disabled={isSubmittingSimpleFin}
                >
                  {isSubmittingSimpleFin ? 'Connecting...' : 'Link SimpleFIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Mock Bank linking overlay modal (Fallback Sandbox) */}
      {showMockModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 100,
          backdropFilter: 'blur(8px)'
        }}>
          <div className="glass-panel" style={{ padding: '36px', maxWidth: '480px', width: '90%', borderColor: 'rgba(0,229,255,0.2)' }}>
            <h2 style={{ fontSize: '22px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Building2 style={{ color: '#34d399' }} />
              Link Sandbox Institution
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px', lineHeight: '1.5' }}>
              Plaid keys are not configured in your `.env.local`. You can link a simulated sandbox bank to test accounts, sync mechanics, and dashboard widgets immediately!
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => handleLinkMockBank('Chase Bank (Sandbox)', 'ins_chase')}
                style={{ justifyContent: 'space-between', padding: '16px' }}
              >
                <span>Chase Checking & Credit Cards</span>
                <Plus size={16} />
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={() => handleLinkMockBank('Fidelity Investments (Sandbox)', 'ins_fidelity')}
                style={{ justifyContent: 'space-between', padding: '16px' }}
              >
                <span>Fidelity 401(k) & Brokerage</span>
                <Plus size={16} />
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={() => handleLinkMockBank('Ally Financial (Sandbox)', 'ins_ally')}
                style={{ justifyContent: 'space-between', padding: '16px' }}
              >
                <span>Ally HYSA Savings</span>
                <Plus size={16} />
              </button>
            </div>
            
            <button 
              className="btn btn-danger" 
              onClick={() => { setShowMockModal(false); setPlaidToken(null); }}
              style={{ width: '100%', marginTop: '24px' }}
            >
              Cancel Linkage
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
