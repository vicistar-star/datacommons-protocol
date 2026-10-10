/**
 * Dataset Detail page.
 *
 * Shows full metadata, contributor list, consent-hash indicator, price and
 * access terms.  Includes a purchase flow that:
 *   1. Calls POST /licenses/build-purchase to get the unsigned XDR.
 *   2. Signs it via the connected wallet.
 *   3. Confirms via POST /licenses/purchase.
 *
 * Supports both time-boxed and query-based licenses (per README hybrid model).
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchDataset, DatasetDTO, buildPurchaseTx, confirmPurchase } from '../hooks/api';
import { useWallet } from '../wallet/WalletContext';

function formatPrice(price: string): string {
  const units = Number(price) / 1e7;
  return `${units.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

function accessDescription(ds: DatasetDTO): string {
  const parts: string[] = [];
  if (ds.duration_secs) {
    const days = Math.round(Number(ds.duration_secs) / 86400);
    parts.push(`Time-boxed: ${days} day${days !== 1 ? 's' : ''} from purchase`);
  }
  if (ds.max_queries) {
    parts.push(`Query-metered: up to ${ds.max_queries} queries`);
  }
  return parts.join(' · ') || 'No access terms specified.';
}

type PurchaseState = 'idle' | 'building' | 'signing' | 'confirming' | 'done' | 'error';

const DatasetDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { address, connect, signTransaction } = useWallet();

  const [dataset, setDataset] = useState<DatasetDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [purchaseState, setPurchaseState] = useState<PurchaseState>('idle');
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [licenseId, setLicenseId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchDataset(id)
      .then(setDataset)
      .catch((e) => setFetchError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  const handlePurchase = async () => {
    if (!dataset?.contract_dataset_id) {
      setPurchaseError('Dataset is not yet registered on-chain.');
      return;
    }
    if (!address) {
      try { await connect(); } catch { return; }
      return;
    }

    setPurchaseState('building');
    setPurchaseError(null);
    try {
      // Step 1: build unsigned XDR
      const unsignedXdr = await buildPurchaseTx(dataset.contract_dataset_id, address);

      // Step 2: sign via wallet
      setPurchaseState('signing');
      const signedXdr = await signTransaction(unsignedXdr);

      // Step 3: confirm on-chain
      setPurchaseState('confirming');
      const { contract_license_id } = await confirmPurchase(signedXdr, address, dataset.id);

      setLicenseId(contract_license_id);
      setPurchaseState('done');
    } catch (e) {
      setPurchaseError((e as Error).message);
      setPurchaseState('error');
    }
  };

  if (loading) return <p>Loading…</p>;
  if (fetchError) return <p style={{ color: '#ef4444' }}>Error: {fetchError}</p>;
  if (!dataset) return <p>Dataset not found.</p>;

  const bpSum = dataset.contributors.reduce((s, c) => s + c.basis_points, 0);

  return (
    <div style={{ maxWidth: '820px' }}>
      <div style={{ marginBottom: '0.75rem' }}>
        <Link to="/" style={{ color: '#3b82f6', textDecoration: 'none', fontSize: '0.9rem' }}>← Marketplace</Link>
      </div>

      <h1 style={h1Style}>{dataset.title}</h1>
      {dataset.category && <span style={badgeStyle}>{dataset.category}</span>}

      <p style={{ color: '#475569', margin: '0.75rem 0 1.25rem', lineHeight: 1.6 }}>
        {dataset.description || 'No description provided.'}
      </p>

      {/* Metadata grid */}
      <div style={gridStyle}>
        <InfoCard label="Price" value={formatPrice(dataset.price)} />
        <InfoCard label="Access" value={accessDescription(dataset)} />
        <InfoCard label="Owner" value={<MonoSpan>{dataset.owner_address}</MonoSpan>} />
        <InfoCard
          label="Consent hash"
          value={
            <span title={dataset.consent_hash} style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#64748b' }}>
              {dataset.consent_hash.slice(0, 16)}…
              <span style={{ marginLeft: '0.5rem', color: '#22c55e', fontSize: '0.8rem' }}>✓ on-chain</span>
            </span>
          }
        />
      </div>

      {/* Contributors */}
      <section style={{ marginTop: '1.5rem' }}>
        <h2 style={h2Style}>Contributors ({dataset.contributors.length})</h2>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>
          Revenue splits sum: {(bpSum / 100).toFixed(2)}%
        </p>
        <div style={contribListStyle}>
          {dataset.contributors.map((c, i) => (
            <div key={i} style={contribRowStyle}>
              <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', flex: 1, wordBreak: 'break-all' }}>
                {c.address}
              </span>
              {c.label && <span style={{ color: '#64748b', fontSize: '0.85rem', marginRight: '0.5rem' }}>{c.label}</span>}
              <span style={bpStyle}>{(c.basis_points / 100).toFixed(2)}%</span>
            </div>
          ))}
        </div>
      </section>

      {/* Purchase panel */}
      <section style={purchasePanelStyle}>
        <h2 style={h2Style}>Purchase License</h2>

        {!dataset.contract_dataset_id && (
          <p style={{ color: '#f59e0b', fontSize: '0.9rem' }}>
            ⚠ This dataset has not been confirmed on-chain yet. Purchase is unavailable.
          </p>
        )}

        {dataset.contract_dataset_id && purchaseState === 'idle' && (
          <>
            <p style={{ color: '#475569', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Purchasing grants you {accessDescription(dataset)}.
              Payment is split automatically on-chain across all contributors.
            </p>
            {!address && (
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                Connect your wallet to purchase.
              </p>
            )}
            <button
              onClick={handlePurchase}
              style={buyBtnStyle}
            >
              {address ? `Buy for ${formatPrice(dataset.price)}` : 'Connect Wallet to Buy'}
            </button>
          </>
        )}

        {(purchaseState === 'building' || purchaseState === 'signing' || purchaseState === 'confirming') && (
          <p style={{ color: '#3b82f6' }}>
            {purchaseState === 'building' && '⏳ Building transaction…'}
            {purchaseState === 'signing' && '✍ Waiting for wallet signature…'}
            {purchaseState === 'confirming' && '⏳ Confirming on-chain…'}
          </p>
        )}

        {purchaseState === 'done' && (
          <div style={{ padding: '1rem', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
            <p style={{ color: '#15803d', fontWeight: 600, marginBottom: '0.25rem' }}>
              ✅ License purchased successfully!
            </p>
            {licenseId && (
              <p style={{ fontSize: '0.85rem', color: '#475569' }}>
                License ID: <code>{licenseId}</code>
              </p>
            )}
            <Link to="/licenses" style={{ color: '#3b82f6', fontSize: '0.9rem' }}>
              View in My Licenses →
            </Link>
          </div>
        )}

        {purchaseState === 'error' && purchaseError && (
          <div style={{ padding: '1rem', background: '#fef2f2', borderRadius: '8px', border: '1px solid #fecaca' }}>
            <p style={{ color: '#dc2626', fontWeight: 600, marginBottom: '0.25rem' }}>Purchase failed</p>
            <p style={{ fontSize: '0.85rem', color: '#475569' }}>{purchaseError}</p>
            <button onClick={() => { setPurchaseState('idle'); setPurchaseError(null); }} style={{ ...buyBtnStyle, marginTop: '0.5rem', background: '#6b7280' }}>
              Try again
            </button>
          </div>
        )}
      </section>
    </div>
  );
};

// Sub-components

const InfoCard: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={infoCardStyle}>
    <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{label}</div>
    <div style={{ fontSize: '0.95rem', color: '#1e293b' }}>{value}</div>
  </div>
);

const MonoSpan: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>{children}</span>
);

// Styles
const h1Style: React.CSSProperties = { fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem' };
const h2Style: React.CSSProperties = { fontSize: '1.15rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.5rem' };
const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  background: '#dbeafe', color: '#1d4ed8',
  fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '4px',
};
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: '0.75rem',
};
const infoCardStyle: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '0.75rem 1rem',
};
const contribListStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  overflow: 'hidden',
};
const contribRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid #f1f5f9',
  gap: '0.5rem',
};
const bpStyle: React.CSSProperties = {
  background: '#e0f2fe', color: '#0369a1',
  padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.8rem', whiteSpace: 'nowrap',
};
const purchasePanelStyle: React.CSSProperties = {
  marginTop: '2rem',
  padding: '1.25rem',
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  background: '#f8fafc',
};
const buyBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.4rem',
  background: '#3b82f6',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '1rem',
};

export default DatasetDetailPage;
