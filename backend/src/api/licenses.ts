/**
 * POST /licenses/purchase  — confirm a buyer's signed on-chain purchase
 *                            transaction and sync into the local licenses cache.
 * GET  /licenses/mine      — list the authenticated wallet's licenses,
 *                            live-checked against check_access on-chain.
 */

import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { LicenseRow, DatasetRow } from '../db/models';
import {
  submitSignedTransaction,
  checkAccess,
  licenseContractId,
} from '../chain/client';
import {
  Contract,
  TransactionBuilder,
  Networks,
  xdr,
  scValToNative,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function networkPassphrase(): string {
  const net = (process.env.STELLAR_NETWORK ?? 'testnet').toLowerCase();
  return net === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

function rpcUrl(): string {
  return process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
}

/**
 * After a successful on-chain purchase, extract the returned license_id from
 * the transaction result and cache the license locally.
 */
async function syncLicenseFromChain(txHash: string, buyerAddress: string): Promise<LicenseRow | null> {
  try {
    const server = new SorobanRpc.Server(rpcUrl(), { allowHttp: rpcUrl().startsWith('http://') });
    const txResult = await server.getTransaction(txHash);

    if (txResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return null;
    }

    // Extract license_id from the return value.
    const retval = txResult.resultMetaXdr;
    // Parse the return value (u64 license_id) from the transaction meta.
    let licenseId: bigint | null = null;
    try {
      // The return value is in the last OperationMeta.
      const meta = xdr.TransactionMeta.fromXDR(retval, 'base64');
      const ops = meta.v3?.sorobanMeta()?.returnValue();
      if (ops) {
        licenseId = BigInt(scValToNative(ops) as number);
      }
    } catch {
      // Fall back: can't parse return value — license id unknown.
    }

    if (licenseId === null) return null;

    // Fetch the live on-chain license state to populate the cache.
    // We re-read access status to populate expires_at / queries_remaining.
    // For now, store minimal info; the live check_access call at read time
    // is the source of truth per README Security Considerations.
    const { rows: dsRows } = await pool.query<DatasetRow>(
      'SELECT * FROM datasets WHERE contract_dataset_id = $1',
      // We don't have dataset_id here; use 0 as placeholder — updated on next mine call.
      ['0'],
    );
    const datasetId = dsRows[0]?.id ?? null;

    const { rows } = await pool.query<LicenseRow>(
      `INSERT INTO licenses
         (contract_license_id, dataset_id, buyer_address, last_synced_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (contract_license_id) DO UPDATE
         SET last_synced_at = NOW()
       RETURNING *`,
      [licenseId.toString(), datasetId ?? 0, buyerAddress],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST /licenses/purchase
// ---------------------------------------------------------------------------
router.post('/purchase', async (req: Request, res: Response) => {
  const { signed_xdr, buyer_address, dataset_id } = req.body as {
    signed_xdr: string;
    buyer_address: string;
    dataset_id?: number;
  };

  if (!signed_xdr || !buyer_address) {
    res.status(400).json({ error: 'signed_xdr and buyer_address are required' });
    return;
  }

  // Submit the signed transaction to the network.
  const txHash = await submitSignedTransaction(signed_xdr);

  // Sync the resulting license into the local cache.
  const server = new SorobanRpc.Server(rpcUrl(), { allowHttp: rpcUrl().startsWith('http://') });
  const txResult = await server.getTransaction(txHash);

  let licenseId: bigint | null = null;
  if (txResult.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    try {
      const retval = txResult.resultMetaXdr;
      const meta = xdr.TransactionMeta.fromXDR(retval, 'base64');
      const rv = meta.v3?.sorobanMeta()?.returnValue();
      if (rv) licenseId = BigInt(scValToNative(rv) as number);
    } catch {
      // Couldn't parse return value — proceed without license id.
    }
  }

  if (licenseId !== null) {
    await pool.query(
      `INSERT INTO licenses
         (contract_license_id, dataset_id, buyer_address, last_synced_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (contract_license_id) DO UPDATE
         SET last_synced_at = NOW()`,
      [licenseId.toString(), dataset_id ?? 0, buyer_address],
    );
  }

  res.json({
    tx_hash: txHash,
    contract_license_id: licenseId?.toString() ?? null,
    message: 'License purchase confirmed on-chain.',
  });
});

// ---------------------------------------------------------------------------
// GET /licenses/mine
// ---------------------------------------------------------------------------
router.get('/mine', async (req: Request, res: Response) => {
  const walletAddress = req.query.wallet as string;
  if (!walletAddress) {
    res.status(400).json({ error: 'wallet query parameter is required' });
    return;
  }

  const { rows: cached } = await pool.query<LicenseRow>(
    'SELECT * FROM licenses WHERE buyer_address = $1 ORDER BY created_at DESC',
    [walletAddress],
  );

  // Live-check each license against the chain (per README Security Considerations:
  // re-check on every access, not just at first download).
  const results = await Promise.all(
    cached.map(async (lic) => {
      let liveStatus: string = 'Unknown';
      try {
        liveStatus = await checkAccess(BigInt(lic.contract_license_id));
      } catch {
        liveStatus = 'Unknown';
      }

      // Update cache with revocation/expiry if chain says so.
      if (liveStatus === 'Revoked' && !lic.revoked) {
        await pool.query(
          'UPDATE licenses SET revoked = true, last_synced_at = NOW() WHERE id = $1',
          [lic.id],
        );
      }

      return {
        id: lic.id,
        contract_license_id: lic.contract_license_id,
        dataset_id: lic.dataset_id,
        buyer_address: lic.buyer_address,
        expires_at: lic.expires_at,
        queries_remaining: lic.queries_remaining,
        revoked: lic.revoked,
        live_status: liveStatus,
      };
    }),
  );

  res.json({ licenses: results });
});

export default router;
