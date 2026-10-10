/**
 * Marketplace page — lists datasets fetched from GET /datasets with basic
 * text search and category filtering.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fetchDatasets, DatasetDTO } from '../hooks/api';

const CATEGORIES = ['health', 'agri', 'climate'];

function formatPrice(price: string): string {
  // price is in stablecoin micro-units (USDC has 7 decimals on Stellar)
  const units = Number(price) / 1e7;
  return `${units.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

function accessLabel(ds: DatasetDTO): string {
  const parts: string[] = [];
  if (ds.duration_secs) parts.push(`${Math.round(Number(ds.duration_secs) / 86400)}d time-boxed`);
  if (ds.max_queries) parts.push(`${ds.max_queries} queries`);
  return parts.join(' + ') || '—';
}

const MarketplacePage: React.FC = () => {
  const [datasets, setDatasets] = useState<DatasetDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (q: string, cat: string, pg: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDatasets({ q: q || undefined, category: cat || undefined, page: pg });
      setDatasets(data.datasets);
      setHasMore(data.datasets.length === 20);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search, category, page), 300);
    return () => clearTimeout(t);
  }, [search, category, page, load]);

  return (
    <div>
      <h1 style={h1}>Research Data Marketplace</h1>
      <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
        Licensed access to health, agricultural, and climate research datasets from the Global South.
      </p>

      {/* Search + filter bar */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search datasets…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={inputStyle}
        />
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPage(1); }}
          style={{ ...inputStyle, maxWidth: '160px' }}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Results */}
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: '#ef4444' }}>Error: {error}</p>}
      {!loading && !error && datasets.length === 0 && (
        <p style={{ color: '#64748b' }}>No datasets found.</p>
      )}

      <div style={gridStyle}>
        {datasets.map((ds) => (
          <Link key={ds.id} to={`/dataset/${ds.id}`} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
              <span style={titleStyle}>{ds.title}</span>
              {ds.category && <span style={badgeStyle}>{ds.category}</span>}
            </div>
            <p style={descStyle}>{ds.description || 'No description.'}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem', fontSize: '0.85rem', color: '#475569' }}>
              <span><strong>Price:</strong> {formatPrice(ds.price)}</span>
              <span><strong>Access:</strong> {accessLabel(ds)}</span>
            </div>
            <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#94a3b8' }}>
              {ds.contributors.length} contributor{ds.contributors.length !== 1 ? 's' : ''}
              {' '}· consent hash: {ds.consent_hash.slice(0, 8)}…
            </div>
          </Link>
        ))}
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem', justifyContent: 'center' }}>
        {page > 1 && (
          <button style={pageBtnStyle} onClick={() => setPage((p) => p - 1)}>← Prev</button>
        )}
        <span style={{ padding: '0.4rem 0.75rem', fontSize: '0.9rem' }}>Page {page}</span>
        {hasMore && (
          <button style={pageBtnStyle} onClick={() => setPage((p) => p + 1)}>Next →</button>
        )}
      </div>
    </div>
  );
};

const h1: React.CSSProperties = { fontSize: '1.8rem', fontWeight: 700, marginBottom: '0.5rem', color: '#0f172a' };
const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  fontSize: '0.95rem',
  flex: 1,
  minWidth: '200px',
};
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: '1rem',
};
const cardStyle: React.CSSProperties = {
  display: 'block',
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  padding: '1rem 1.25rem',
  textDecoration: 'none',
  color: 'inherit',
  background: '#fff',
  transition: 'box-shadow 0.15s',
  cursor: 'pointer',
};
const titleStyle: React.CSSProperties = { fontWeight: 600, fontSize: '1rem', color: '#1e293b' };
const descStyle: React.CSSProperties = { color: '#64748b', fontSize: '0.9rem', margin: '0.25rem 0 0', lineHeight: 1.4 };
const badgeStyle: React.CSSProperties = {
  background: '#dbeafe',
  color: '#1d4ed8',
  fontSize: '0.75rem',
  padding: '0.15rem 0.5rem',
  borderRadius: '4px',
  whiteSpace: 'nowrap',
};
const pageBtnStyle: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  cursor: 'pointer',
  background: '#f8fafc',
};

export default MarketplacePage;
