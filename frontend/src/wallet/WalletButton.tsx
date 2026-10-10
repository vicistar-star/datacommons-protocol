/**
 * WalletButton — connect/disconnect button shown in the nav bar.
 *
 * - If no wallet connected: shows "Connect Wallet" button.
 * - If connected: shows a truncated address and a "Disconnect" button.
 */

import React from 'react';
import { useWallet } from './WalletContext';

function truncate(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const WalletButton: React.FC = () => {
  const { address, connecting, connect, disconnect } = useWallet();

  if (address) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }} title={address}>
          {truncate(address)}
        </span>
        <button onClick={disconnect} style={btnStyle}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button onClick={connect} disabled={connecting} style={btnStyle}>
      {connecting ? 'Connecting…' : 'Connect Wallet'}
    </button>
  );
};

const btnStyle: React.CSSProperties = {
  padding: '0.4rem 0.9rem',
  borderRadius: '6px',
  border: '1px solid #3b82f6',
  background: '#3b82f6',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '0.9rem',
};

export default WalletButton;
