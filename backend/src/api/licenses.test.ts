/**
 * Integration tests for POST /licenses/purchase and GET /licenses/mine.
 * Mocks DB pool, Soroban RPC, and chain client.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mock chain client
// ---------------------------------------------------------------------------
vi.mock('../chain/client', () => ({
  submitSignedTransaction: vi.fn(async (_xdr: string) => 'txhash_abc'),
  checkAccess: vi.fn(async (_id: bigint) => 'Active'),
  licenseContractId: () => 'CLIC',
  registryContractId: () => 'CREG',
  stablecoinContractId: () => 'CUSDC',
  buildRegisterDatasetTx: vi.fn(async () => 'XDRXDR'),
  getProvenanceEvents: vi.fn(async () => []),
}));

// ---------------------------------------------------------------------------
// Mock @stellar/stellar-sdk rpc.Server
// ---------------------------------------------------------------------------
vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();

  class FakeServer {
    async getTransaction(_hash: string) {
      return {
        status: actual.rpc.Api.GetTransactionStatus.SUCCESS,
        resultMetaXdr: '',
      };
    }
  }

  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: FakeServer,
      Api: {
        ...actual.rpc.Api,
        GetTransactionStatus: { SUCCESS: 'SUCCESS', FAILED: 'FAILED', NOT_FOUND: 'NOT_FOUND' },
      },
    },
  };
});

// ---------------------------------------------------------------------------
// Mock DB pool
// ---------------------------------------------------------------------------
const mockLicenses = [
  {
    id: 1,
    contract_license_id: '42',
    dataset_id: 1,
    buyer_address: 'GBUYER',
    expires_at: null,
    queries_remaining: 5,
    revoked: false,
    last_synced_at: new Date(),
    created_at: new Date(),
  },
];

vi.mock('../db/pool', () => ({
  default: {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM licenses WHERE buyer_address')) {
        return { rows: mockLicenses };
      }
      if (sql.includes('UPDATE licenses')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO licenses')) {
        return { rows: [mockLicenses[0]] };
      }
      return { rows: [] };
    }),
  },
}));

const { app } = await import('../index');

describe('POST /licenses/purchase', () => {
  it('requires signed_xdr and buyer_address', async () => {
    const res = await request(app).post('/licenses/purchase').send({});
    expect(res.status).toBe(400);
  });

  it('returns tx_hash on success', async () => {
    const res = await request(app)
      .post('/licenses/purchase')
      .send({ signed_xdr: 'FAKEXDR==', buyer_address: 'GBUYER' });
    expect(res.status).toBe(200);
    expect(res.body.tx_hash).toBe('txhash_abc');
  });
});

describe('GET /licenses/mine', () => {
  it('requires wallet query param', async () => {
    const res = await request(app).get('/licenses/mine');
    expect(res.status).toBe(400);
  });

  it('returns licenses with live_status', async () => {
    const res = await request(app).get('/licenses/mine?wallet=GBUYER');
    expect(res.status).toBe(200);
    expect(res.body.licenses).toHaveLength(1);
    expect(res.body.licenses[0].live_status).toBe('Active');
  });
});
