/**
 * NavBar — top navigation shared across all pages.
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import WalletButton from '../wallet/WalletButton';

const links = [
  { to: '/', label: 'Marketplace' },
  { to: '/licenses', label: 'My Licenses' },
  { to: '/register', label: 'Register Dataset' },
];

const NavBar: React.FC = () => {
  const { pathname } = useLocation();
  return (
    <nav style={navStyle}>
      <Link to="/" style={logoStyle}>DataCommons Protocol</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            style={{
              ...linkStyle,
              fontWeight: pathname === l.to ? 700 : 400,
              borderBottom: pathname === l.to ? '2px solid #3b82f6' : '2px solid transparent',
            }}
          >
            {l.label}
          </Link>
        ))}
        <WalletButton />
      </div>
    </nav>
  );
};

const navStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.75rem 2rem',
  background: '#0f172a',
  color: '#f8fafc',
  position: 'sticky',
  top: 0,
  zIndex: 100,
  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
};

const logoStyle: React.CSSProperties = {
  color: '#f8fafc',
  fontWeight: 700,
  fontSize: '1.1rem',
  textDecoration: 'none',
};

const linkStyle: React.CSSProperties = {
  color: '#cbd5e1',
  textDecoration: 'none',
  fontSize: '0.95rem',
  paddingBottom: '2px',
};

export default NavBar;
