/**
 * Route integration tests for /datasets and /provenance.
 * Mocks the Postgres pool and the chain client so no live DB or RPC needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mock DB pool
// ---------------------------------------------------------------------------
vi.mock('../db/pool', () => {
  const rows = {
    datasets: [
      {
        id: 1,
        contract_dataset_id: '42',
        owner_address: 'GOWNER',
        title: 'Health Dataset',
        description: 'Malaria incidence data',
        metadata_uri: 'ipfs://Qm123',
        consent_hash: 'abc123',
        price: '1000000',
        duration_secs: '86400',
        max_queries: null,
        schema_preview: null,
        category: 'health',
        created_at: new Date(),
      },
    ],
    contributors: [
      { id: 1, dataset_id: 1, address: 'GOWNER', basis_points: 10000, label: 'PI' },
    ],
  };

  const mockClient = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO datasets')) {
        return { rows: [{ ...rows.datasets[0], id: 99 }] };
      }
      if (sql.includes('INSERT INTO contributors')) {
        return { rows: [] };
      }
      if (sql.includes('UPDATE datasets')) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };

  return {
    default: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM datasets d')) {
          return { rows: rows.datasets };
        }
        if (sql.includes('FROM datasets WHERE id')) {
          const id = params?.[0];
          const found = rows.datasets.filter((d) => String(d.id) === String(id));
          return { rows: found };
        }
        if (sql.includes('FROM contributors')) {
          return { rows: rows.contributors };
        }
        return { rows: [] };
      }),
      connect: vi.fn(async () => mockClient),
    },
  };
});

// ---------------------------------------------------------------------------
// Mock chain client
// ---------------------------------------------------------------------------
vi.mock('../chain/client', () => ({
  buildRegisterDatasetTx: vi.fn(async () => 'FAKEXDR=='),
  getDataset: vi.fn(async () => ({})),
  getProvenanceEvents: vi.fn(async () => [
    { topic: 'REGISTRY/Register', data: { id: 1n }, ledger: 100, timestamp: 0 },
  ]),
  registryContractId: () => 'CREG',
  licenseContractId: () => 'CLIC',
  stablecoinContractId: () => 'CUSDC',
}));

// ---------------------------------------------------------------------------
// Import app after mocks are in place
// ---------------------------------------------------------------------------
const { app } = await import('../index');

describe('GET /datasets', () => {
  it('returns a list of datasets', async () => {
    const res = await request(app).get('/datasets');
    expect(res.status).toBe(200);
    expect(res.body.datasets).toHaveLength(1);
    expect(res.body.datasets[0].title).toBe('Health Dataset');
  });
});

describe('GET /datasets/:id', () => {
  it('returns dataset detail with contributors', async () => {
    const res = await request(app).get('/datasets/1');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Health Dataset');
    expect(res.body.contributors).toHaveLength(1);
    expect(res.body.contributors[0].basis_points).toBe(10000);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/datasets/9999');
    expect(res.status).toBe(404);
  });
});

describe('POST /datasets', () => {
  it('saves off-chain metadata and returns unsigned XDR', async () => {
    const res = await request(app)
      .post('/datasets')
      .send({
        owner_address: 'GOWNER',
        title: 'New Dataset',
        metadata_uri: 'ipfs://Qmnew',
        consent_hash: '00'.repeat(32),
        price: '500000',
        duration_secs: '86400',
        contributors: [{ address: 'GOWNER', basis_points: 10000 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.unsigned_xdr).toBe('FAKEXDR==');
    expect(res.body.dataset_id).toBeDefined();
  });

  it('rejects invalid contributor basis points sum', async () => {
    const res = await request(app)
      .post('/datasets')
      .send({
        owner_address: 'GOWNER',
        title: 'Bad Dataset',
        metadata_uri: 'ipfs://Qmbad',
        consent_hash: '00'.repeat(32),
        price: '500000',
        duration_secs: '86400',
        contributors: [{ address: 'GOWNER', basis_points: 5000 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/10000/);
  });

  it('rejects missing access terms', async () => {
    const res = await request(app)
      .post('/datasets')
      .send({
        owner_address: 'GOWNER',
        title: 'No Terms',
        metadata_uri: 'ipfs://Qmnt',
        consent_hash: '00'.repeat(32),
        price: '500000',
        contributors: [{ address: 'GOWNER', basis_points: 10000 }],
      });
    expect(res.status).toBe(400);
  });
});

describe('GET /provenance/:datasetId', () => {
  it('returns on-chain events for a dataset', async () => {
    const res = await request(app).get('/provenance/1');
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].topic).toContain('REGISTRY');
  });
});
