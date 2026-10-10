/**
 * WalletContext — React context wrapping the Stellar Wallets Kit.
 *
 * Provides:
 *   - address: string | null         connected wallet public key
 *   - connecting: boolean            true while the connect dialog is open
 *   - connect()                      open wallet-selection dialog
 *   - disconnect()                   clear session
 *   - signTransaction(xdr): Promise  sign an XDR transaction envelope
 *
 * Uses @creit.tech/stellar-wallets-kit (static API) with FreighterModule as
 * the primary module and AlbedoModule / LobstrModule as fallbacks, per README.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { StellarWalletsKit, Networks } from '@creit.tech/stellar-wallets-kit';
import { FreighterModule, FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr';

// ---------------------------------------------------------------------------
// Kit initialisation (once, at module load time)
// ---------------------------------------------------------------------------

const network =
  (import.meta.env.VITE_STELLAR_NETWORK as string | undefined)?.toLowerCase() === 'mainnet'
    ? Networks.PUBLIC
    : Networks.TESTNET;

StellarWalletsKit.init({
  modules: [new FreighterModule(), new AlbedoModule(), new LobstrModule()],
  network,
});

// ---------------------------------------------------------------------------
// Context value type
// ---------------------------------------------------------------------------

export interface WalletContextValue {
  address: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Context + provider
// ---------------------------------------------------------------------------

const WalletContext = createContext<WalletContextValue>({
  address: null,
  connecting: false,
  connect: async () => {},
  disconnect: () => {},
  signTransaction: async () => '',
});

const STORAGE_KEY = 'datacommons_wallet_address';

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [address, setAddress] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [connecting, setConnecting] = useState(false);

  // On mount, try to restore the previously-connected address silently.
  useEffect(() => {
    if (address) {
      StellarWalletsKit.getAddress()
        .then(({ address: a }) => {
          setAddress(a);
          sessionStorage.setItem(STORAGE_KEY, a);
        })
        .catch(() => {
          // Wallet not available / not connected — clear stale session.
          setAddress(null);
          sessionStorage.removeItem(STORAGE_KEY);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      // Default to Freighter (most common Stellar browser extension).
      StellarWalletsKit.setWallet(FREIGHTER_ID);
      const { address: a } = await StellarWalletsKit.fetchAddress();
      setAddress(a);
      sessionStorage.setItem(STORAGE_KEY, a);
    } catch (err) {
      console.error('Wallet connect failed:', err);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const signTransaction = useCallback(async (xdr: string): Promise<string> => {
    if (!address) throw new Error('Wallet not connected');
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
      networkPassphrase: network,
      address,
    });
    return signedTxXdr;
  }, [address]);

  return (
    <WalletContext.Provider value={{ address, connecting, connect, disconnect, signTransaction }}>
      {children}
    </WalletContext.Provider>
  );
};

export function useWallet(): WalletContextValue {
  return useContext(WalletContext);
}
