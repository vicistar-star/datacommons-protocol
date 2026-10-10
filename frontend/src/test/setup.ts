import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock the Stellar Wallets Kit before any module imports it.
// The kit tries to import @stellar/freighter-api (CJS) which breaks in ESM test env.
vi.mock('@creit.tech/stellar-wallets-kit', () => ({
  StellarWalletsKit: {
    init: vi.fn(),
    setWallet: vi.fn(),
    fetchAddress: vi.fn().mockResolvedValue({ address: 'GTEST1234' }),
    getAddress: vi.fn().mockResolvedValue({ address: 'GTEST1234' }),
    signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: 'SIGNED_XDR' }),
    setNetwork: vi.fn(),
  },
  Networks: {
    PUBLIC: 'Public Global Stellar Network ; September 2015',
    TESTNET: 'Test SDF Network ; September 2015',
  },
}));

vi.mock('@creit.tech/stellar-wallets-kit/modules/freighter', () => ({
  FreighterModule: vi.fn().mockImplementation(() => ({})),
  FREIGHTER_ID: 'freighter',
}));

vi.mock('@creit.tech/stellar-wallets-kit/modules/albedo', () => ({
  AlbedoModule: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@creit.tech/stellar-wallets-kit/modules/lobstr', () => ({
  LobstrModule: vi.fn().mockImplementation(() => ({})),
}));
