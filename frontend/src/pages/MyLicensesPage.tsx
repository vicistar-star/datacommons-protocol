/**
 * My Licenses page.
 *
 * Lists the connected wallet's licenses from GET /licenses/mine (live-checked
 * against the chain). For query-based licenses, provides a simple form to
 * submit queries via POST /query/:licenseId.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fetchMyLicenses, submitQuery, LicenseDTO, QueryResult } from '../hooks/api';
import { useWallet } from '../wallet/WalletContext';

// ---------------------------------------------------------------------------
// Query submission sub-component
// ---------------------------------------------------------------------------

type QueryType = 'count' | 'sample' | 'filter';

const QueryForm: React.FC<{ licenseId: string }> = ({ licenseId }) => {
  const [queryType, setQueryType] = useState<QueryType>('count');
  const [sampleN, setSampleN] = useState('5');
  const [filterField, setFilterField] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let q;
      if (queryType === 'count') {
        q = { type: 'count' as const };
      } else if (queryType === 'sample') {
        q = { type: 'sample' as const, n: parseInt(sampleN, 10) || 5 };
      } else {
        q = { type: 'filter' as const, field: filterField, value: filterValue };
      }
      const r = await submitQuery(licenseId, q);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={queryFormStyle}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', fontWeight: 600 }}>Submit a query</h4>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
        <label style={labelStyle}>
          Type
          <select
            value={queryType}
            onChange={(e) => setQueryType(e.target.value as QueryType)}
            style={selectStyle}
          >
            <option value="count">Count</option>
            <option value="sample">Sample</option>
            <option value="filter">Filter</option>
          </select>
        </label>

        {queryType === 'sample' && (
          <label style={labelStyle}>
            N rows
            <input
              type="number"
              value={sampleN}
              min={1}
              onChange={(e) => setSampleN(e.target.value)}
              style={inputStyle}
            />
          </label>
        )}

        {queryType === 'filter' && (
          <>
            <label style={labelStyle}>
              Field
              <input
                type="text"
                value={filterField}
                onChange={(e) => setFilterField(e.target.value)}
                placeholder="e.g. country"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Value
              <input
                type="text"
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                placeholder="e.g. Kenya"
                style={inputStyle}
              />
            </label>
          </>
        )}

        <button type="submit" disabled={loading} style={submitBtnStyle}>
          {loading ? 'Running…' : 'Run'}
        </button>
      </form>

      {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '0.5rem' }}>{error}</p>}

      {result && (
        <details style={{ marginTop: '0.75rem' }} open>
          <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>Result</summary>
          <pre style={preStyle}>{JSON.stringify(result.result, null, 2)}</pre>
        </details>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// License card
// ---------------------------------------------------------------------------

const LicenseCard: React.FC<{ license: LicenseDTO }> = ({ license }) => {
  const statusColor: Record<string, string> = {
    Active: '#22c55e',
    Expired: '#f59e0b',
    QueryExhausted: '#f59e0b',
    Revoked: '#ef4444',
    Unknown: '#94a3b8',
  };
  const color = statusColor[license.live_status] ?? '#94a3b8';
  const isQueryBased = license.queries_remaining !== null;

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
          License #{license.contract_license_id}
        </span>
        <span style={{ ...statusBadgeStyle, background: `${color}20`, color }}>
          {license.live_status}
        </span>
      </div>

      <div style={{ fontSize: '0.85rem', color: '#475569', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
        <span>Dataset DB #{license.dataset_id}</span>
        {license.expires_at && (
          <span>Expires: {new Date(license.expires_at).toLocaleDateString()}</span>
        )}
        {license.queries_remaining !== null && (
          <span>Queries remaining: {license.queries_remaining}</span>
        )}
      </div>

      {/* Query form for query-based active licenses */}
      {isQueryBased && license.live_status === 'Active' && (
        <QueryForm licenseId={license.contract_license_id} />
      )}

      {/* Time-boxed active: show access info */}
      {!isQueryBased && license.live_status === 'Active' && (
        <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#64748b' }}>
          Time-boxed license — access granted until expiry.
          The decryption key for the dataset is released by the backend after on-chain verification.
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// My Licenses page
// ---------------------------------------------------------------------------

const MyLicensesPage: React.FC = () => {
  const { address, connect } = useWallet();
  const [licenses, setLicenses] = useState<LicenseDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (addr: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyLicenses(addr);
      setLicenses(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (address) load(address);
  }, [address, load]);

  if (!address) {
    return (
      <div style={{ textAlign: 'center', marginTop: '4rem' }}>
        <h1 style={h1Style}>My Licenses</h1>
        <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
          Connect your wallet to view your licenses.
        </p>
        <button onClick={connect} style={connectBtnStyle}>Connect Wallet</button>
      </div>
    );
  }

  return (
    <div>
      <h1 style={h1Style}>My Licenses</h1>
      <p style={{ color: '#64748b', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
        Wallet: <code style={{ background: '#f1f5f9', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{address}</code>
      </p>

      {loading && <p>Loading licenses…</p>}
      {error && <p style={{ color: '#ef4444' }}>Error: {error}</p>}
      {!loading && !error && licenses.length === 0 && (
        <div style={{ color: '#64748b', textAlign: 'center', marginTop: '3rem' }}>
          <p>No licenses yet.</p>
          <Link to="/" style={{ color: '#3b82f6' }}>Browse the Marketplace →</Link>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {licenses.map((lic) => (
          <LicenseCard key={lic.id} license={lic} />
        ))}
      </div>
    </div>
  );
};

// Styles
const h1Style: React.CSSProperties = { fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.5rem' };
const connectBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.4rem', background: '#3b82f6', color: '#fff',
  border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '1rem',
};
const cardStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem 1.25rem', background: '#fff',
};
const statusBadgeStyle: React.CSSProperties = {
  padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600,
};
const queryFormStyle: React.CSSProperties = {
  marginTop: '0.75rem', padding: '0.75rem', background: '#f8fafc',
  borderRadius: '8px', border: '1px solid #e2e8f0',
};
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.8rem', color: '#475569' };
const inputStyle: React.CSSProperties = { padding: '0.35rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '5px', fontSize: '0.9rem' };
const selectStyle: React.CSSProperties = { ...inputStyle };
const submitBtnStyle: React.CSSProperties = {
  padding: '0.4rem 1rem', background: '#3b82f6', color: '#fff',
  border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
};
const preStyle: React.CSSProperties = {
  background: '#0f172a', color: '#e2e8f0', padding: '0.75rem', borderRadius: '6px',
  fontSize: '0.8rem', overflowX: 'auto', maxHeight: '300px',
};

export default MyLicensesPage;
