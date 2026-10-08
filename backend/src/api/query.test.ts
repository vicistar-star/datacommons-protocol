/**
 * Integration tests for POST /query/:licenseId.
 *
 * Also contains the end-to-end scenario tests required by Plan.md Day 5:
 *   (a) time-boxed license — access granted then denied after simulated expiry.
 *   (b) query-based license — N queries succeed, N+1 is rejected.
 *
 * All Soroban RPC calls and DB queries are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Shared state for simulating on-chain access status
// ---------------------------------------------------------------------------
let mockAccessStatus = 'Active';
let mockConsumeQueryCalled = 0;

vi.mock('../chain/client', () => ({
  checkAccess: vi.fn(async (_id: bigint) => mockAccessStatus),
  consumeQuery: vi.fn(async (_id: bigint) => {
    mockConsumeQueryCalled++;
  }),
  submitSignedTransaction: vi.fn(async () => 'txhash'),
  licenseContractId: () => 'CLIC',
  registryContractId: () => 'CREG',
  stablecoinContractId: () => 'CUSDC',
  buildRegisterDatasetTx: vi.fn(async () => 'XDR'),
  getProvenanceEvents: vi.fn(async () => []),
}));

// ---------------------------------------------------------------------------
// Mock storage — return deterministic NDJSON plaintext
// ---------------------------------------------------------------------------
const SAMPLE_NDJSON =
  '{"id":1,"country":"KE","value":42}\n' +
  '{"id":2,"country":"NG","value":99}\n' +
  '{"id":3,"country":"KE","value":7}\n';

vi.mock('../storage/index', () => ({
  downloadAndDecrypt: vi.fn(async () => Buffer.from(SAMPLE_NDJSON)),
  encryptDataset: vi.fn(),
  decryptDataset: vi.fn(),
  hashConsentDocument: vi.fn(),
  deriveDatasetKey: vi.fn(),
  encryptAndUpload: vi.fn(),
  uploadEncryptedToIPFS: vi.fn(),
  downloadEncryptedFromIPFS: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock DB pool
// ---------------------------------------------------------------------------
vi.mock('../db/pool', () => ({
  default: {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM licenses WHERE contract_license_id')) {
        return {
          rows: [
            {
              id: 1,
              contract_license_id: '1',
              dataset_id: 1,
              buyer_address: 'GBUYER',
              expires_at: null,
              queries_remaining: null,
              revoked: false,
            },
          ],
        };
      }
      if (sql.includes('FROM datasets WHERE id')) {
        return {
          rows: [
            {
              id: 1,
              contract_dataset_id: '42',
              owner_address: 'GOWNER',
              title: 'Test Dataset',
              description: '',
              metadata_uri: 'ipfs://Qmtest',
              consent_hash: '00'.repeat(32),
              price: '1000',
              duration_secs: null,
              max_queries: null,
              schema_preview: null,
              category: 'health',
              created_at: new Date(),
            },
          ],
        };
      }
      // licenses/mine and licenses/purchase mocks
      if (sql.includes('FROM licenses WHERE buyer_address')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO licenses') || sql.includes('UPDATE licenses')) {
        return { rows: [] };
      }
      // datasets queries
      if (sql.includes('FROM datasets d')) {
        return { rows: [] };
      }
      if (sql.includes('FROM datasets WHERE id')) {
        return { rows: [] };
      }
      if (sql.includes('FROM contributors')) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    connect: vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [{ id: 99 }] })),
      release: vi.fn(),
    })),
  },
}));

// ---------------------------------------------------------------------------
// Mock @stellar/stellar-sdk
// ---------------------------------------------------------------------------
vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  class FakeServer {
    async getTransaction(_hash: string) {
      return { status: actual.rpc.Api.GetTransactionStatus.SUCCESS, resultMetaXdr: '' };
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

const { app } = await import('../index');

// ---------------------------------------------------------------------------
// Basic query proxy tests
// ---------------------------------------------------------------------------
describe('POST /query/:licenseId', () => {
  beforeEach(() => {
    mockAccessStatus = 'Active';
    mockConsumeQueryCalled = 0;
  });

  it('rejects missing query type', async () => {
    const res = await request(app).post('/query/1').send({});
    expect(res.status).toBe(400);
  });

  it('executes a count query and returns count only', async () => {
    const res = await request(app)
      .post('/query/1')
      .send({ type: 'count' });
    expect(res.status).toBe(200);
    expect(res.body.result.count).toBe(3);
    // Must NOT include raw records.
    expect(res.body.result.records).toBeUndefined();
    expect(mockConsumeQueryCalled).toBe(1);
  });

  it('executes a sample query', async () => {
    const res = await request(app)
      .post('/query/1')
      .send({ type: 'sample', n: 2 });
    expect(res.status).toBe(200);
    expect(res.body.result.sample).toHaveLength(2);
    expect(res.body.result.total).toBe(3);
  });

  it('executes a filter query', async () => {
    const res = await request(app)
      .post('/query/1')
      .send({ type: 'filter', field: 'country', value: 'KE' });
    expect(res.status).toBe(200);
    expect(res.body.result.matched).toBe(2);
  });

  it('denies access when status is Expired', async () => {
    mockAccessStatus = 'Expired';
    const res = await request(app)
      .post('/query/1')
      .send({ type: 'count' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Expired/);
    expect(mockConsumeQueryCalled).toBe(0);
  });

  it('denies access when status is Revoked', async () => {
    mockAccessStatus = 'Revoked';
    const res = await request(app)
      .post('/query/1')
      .send({ type: 'count' });
    expect(res.status).toBe(403);
    expect(mockConsumeQueryCalled).toBe(0);
  });

  it('denies access when status is QueryExhausted', async () => {
    mockAccessStatus = 'QueryExhausted';
    const res = await request(app)
      .post('/query/1')
      .send({ type: 'count' });
    expect(res.status).toBe(403);
    expect(mockConsumeQueryCalled).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end scenario (a): time-boxed license — access then expiry
// ---------------------------------------------------------------------------
describe('E2E: time-boxed license flow', () => {
  it('grants access while Active, denies after Expired', async () => {
    // License is active.
    mockAccessStatus = 'Active';
    const active = await request(app)
      .post('/query/1')
      .send({ type: 'count' });
    expect(active.status).toBe(200);
    expect(active.body.result.count).toBe(3);

    // Simulate ledger advancing past expiry — check_access now returns Expired.
    mockAccessStatus = 'Expired';
    const expired = await request(app)
      .post('/query/1')
      .send({ type: 'count' });
    expect(expired.status).toBe(403);
    expect(expired.body.error).toMatch(/Expired/);
  });
});

// ---------------------------------------------------------------------------
// End-to-end scenario (b): query-based license — N queries then exhaustion
// ---------------------------------------------------------------------------
describe('E2E: query-based license — N queries then rejection', () => {
  it('allows exactly N queries then rejects the N+1th', async () => {
    const N = 3;
    // Simulate a query-metered license: first N calls return Active, then QueryExhausted.
    let callCount = 0;
    const { checkAccess } = await import('../chain/client');
    vi.mocked(checkAccess).mockImplementation(async () => {
      callCount++;
      return callCount <= N ? 'Active' : 'QueryExhausted';
    });

    // N successful queries.
    for (let i = 0; i < N; i++) {
      const res = await request(app)
        .post('/query/1')
        .send({ type: 'count' });
      expect(res.status).toBe(200);
    }

    // N+1th query must be rejected.
    const rejected = await request(app)
      .post('/query/1')
      .send({ type: 'count' });
    expect(rejected.status).toBe(403);
    expect(rejected.body.error).toMatch(/QueryExhausted/);
  });
});
