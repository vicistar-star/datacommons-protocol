/**
 * End-to-end backend scenario tests.
 *
 * Covers both flows from Plan.md Day 5 Definition of Done:
 *
 *   Scenario A — time-boxed license:
 *     register dataset → purchase (time-boxed) → access granted
 *     → access denied after simulated expiry
 *
 *   Scenario B — query-based license:
 *     register dataset → purchase (query-based) → N successful queries
 *     → N+1th query rejected
 *
 * All on-chain calls and DB access are mocked so these run offline.
 * The scenarios validate end-to-end wiring of the HTTP layer → chain client
 * → storage → proxy — the full request/response path for each use case.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Per-scenario access-status state machine
// ---------------------------------------------------------------------------
type AccessStatus = 'Active' | 'Expired' | 'QueryExhausted' | 'Revoked';

class LicenseStateMachine {
  private status: AccessStatus = 'Active';
  private queriesLeft: number | null;

  constructor(opts: { queriesLeft?: number } = {}) {
    this.queriesLeft = opts.queriesLeft ?? null;
  }

  check(): AccessStatus {
    return this.status;
  }

  consume(): void {
    if (this.queriesLeft !== null) {
      this.queriesLeft--;
      if (this.queriesLeft <= 0) {
        this.status = 'QueryExhausted';
      }
    }
  }

  expire(): void {
    this.status = 'Expired';
  }

  revoke(): void {
    this.status = 'Revoked';
  }
}

let machine = new LicenseStateMachine();

vi.mock('./chain/client', () => ({
  checkAccess: vi.fn(async (_id: bigint) => machine.check()),
  consumeQuery: vi.fn(async (_id: bigint) => machine.consume()),
  submitSignedTransaction: vi.fn(async (_xdr: string) => 'e2e_txhash'),
  buildRegisterDatasetTx: vi.fn(async () => 'E2E_XDR=='),
  getProvenanceEvents: vi.fn(async () => []),
  licenseContractId: () => 'CLIC',
  registryContractId: () => 'CREG',
  stablecoinContractId: () => 'CUSDC',
}));

vi.mock('./storage/index', () => ({
  downloadAndDecrypt: vi.fn(async () =>
    Buffer.from(
      '{"id":1,"region":"west_africa","crop":"maize","yield_kg":320}\n' +
      '{"id":2,"region":"east_africa","crop":"sorghum","yield_kg":280}\n' +
      '{"id":3,"region":"west_africa","crop":"millet","yield_kg":195}\n',
    ),
  ),
  hashConsentDocument: vi.fn((buf: Buffer) => buf.slice(0, 32)),
  encryptDataset: vi.fn(),
  decryptDataset: vi.fn(),
  deriveDatasetKey: vi.fn(),
  encryptAndUpload: vi.fn(),
  uploadEncryptedToIPFS: vi.fn(),
  downloadEncryptedFromIPFS: vi.fn(),
}));

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

const mockLicense = {
  id: 10,
  contract_license_id: '10',
  dataset_id: 5,
  buyer_address: 'GBUYER_E2E',
  expires_at: null,
  queries_remaining: null,
  revoked: false,
  last_synced_at: new Date(),
  created_at: new Date(),
};

const mockDataset = {
  id: 5,
  contract_dataset_id: '99',
  owner_address: 'GOWNER_E2E',
  title: 'Agri Yield Dataset',
  description: 'Crop yield data from West and East Africa',
  metadata_uri: 'ipfs://QmAgri',
  consent_hash: '00'.repeat(32),
  price: '2000000',
  duration_secs: '86400',
  max_queries: null,
  schema_preview: null,
  category: 'agri',
  created_at: new Date(),
};

vi.mock('./db/pool', () => ({
  default: {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM datasets d')) return { rows: [mockDataset] };
      if (sql.includes('FROM datasets WHERE id')) return { rows: [mockDataset] };
      if (sql.includes('FROM contributors')) {
        return {
          rows: [{ id: 1, dataset_id: 5, address: 'GOWNER_E2E', basis_points: 10000, label: 'PI' }],
        };
      }
      if (sql.includes('FROM licenses WHERE contract_license_id')) return { rows: [mockLicense] };
      if (sql.includes('FROM licenses WHERE buyer_address')) return { rows: [mockLicense] };
      if (sql.includes('INSERT INTO licenses') || sql.includes('UPDATE licenses')) {
        return { rows: [mockLicense] };
      }
      return { rows: [] };
    }),
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO datasets')) return { rows: [mockDataset] };
        return { rows: [] };
      }),
      release: vi.fn(),
    })),
  },
}));

const { app } = await import('./index');

// ===========================================================================
// Scenario A — time-boxed license
// ===========================================================================
describe('Scenario A: time-boxed license', () => {
  it('Step 1 — registers a dataset and receives unsigned XDR', async () => {
    const res = await request(app)
      .post('/datasets')
      .send({
        owner_address: 'GOWNER_E2E',
        title: 'Agri Yield Dataset',
        description: 'Crop yield data from West and East Africa',
        metadata_uri: 'ipfs://QmAgri',
        consent_hash: '00'.repeat(32),
        price: '2000000',
        duration_secs: '86400',      // time-boxed: 24 h
        contributors: [{ address: 'GOWNER_E2E', basis_points: 10000 }],
        category: 'agri',
      });
    expect(res.status).toBe(201);
    expect(res.body.unsigned_xdr).toBe('E2E_XDR==');
  });

  it('Step 2 — purchase confirmed on-chain', async () => {
    machine = new LicenseStateMachine(); // fresh Active state
    const res = await request(app)
      .post('/licenses/purchase')
      .send({ signed_xdr: 'SIGNED_XDR==', buyer_address: 'GBUYER_E2E' });
    expect(res.status).toBe(200);
    expect(res.body.tx_hash).toBe('e2e_txhash');
  });

  it('Step 3 — query succeeds while license is Active', async () => {
    machine = new LicenseStateMachine(); // Active
    const res = await request(app)
      .post('/query/10')
      .send({ type: 'count' });
    expect(res.status).toBe(200);
    expect(res.body.result.count).toBe(3);
  });

  it('Step 4 — query denied after expiry (re-checked on every access)', async () => {
    machine = new LicenseStateMachine();
    machine.expire(); // simulate ledger advancing past expires_at
    const res = await request(app)
      .post('/query/10')
      .send({ type: 'count' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Expired/);
  });

  it('Step 5 — licenses/mine reflects live status', async () => {
    machine = new LicenseStateMachine();
    machine.expire();
    const res = await request(app).get('/licenses/mine?wallet=GBUYER_E2E');
    expect(res.status).toBe(200);
    expect(res.body.licenses[0].live_status).toBe('Expired');
  });
});

// ===========================================================================
// Scenario B — query-based license (N queries, then rejection)
// ===========================================================================
describe('Scenario B: query-based license — exactly N queries then rejection', () => {
  const N = 3;

  it(`Step 1 — allows exactly ${N} queries`, async () => {
    machine = new LicenseStateMachine({ queriesLeft: N });

    for (let i = 1; i <= N; i++) {
      const res = await request(app)
        .post('/query/10')
        .send({ type: 'filter', field: 'region', value: 'west_africa' });
      expect(res.status).toBe(200);
      expect(res.body.result.matched).toBe(2);
    }
  });

  it(`Step 2 — rejects the ${N + 1}th query with QueryExhausted`, async () => {
    // machine.status is now QueryExhausted from the previous test.
    // Ensure check returns QueryExhausted.
    machine = new LicenseStateMachine({ queriesLeft: 0 });
    machine.consume(); // triggers QueryExhausted immediately

    const res = await request(app)
      .post('/query/10')
      .send({ type: 'count' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/QueryExhausted/);
  });

  it('Step 3 — verify consume_query was never called after exhaustion', async () => {
    const { consumeQuery } = await import('./chain/client');
    const callsBefore = vi.mocked(consumeQuery).mock.calls.length;

    machine = new LicenseStateMachine({ queriesLeft: 0 });
    machine.consume(); // status = QueryExhausted

    await request(app).post('/query/10').send({ type: 'count' });

    // consumeQuery must NOT have been called (access denied before consume).
    expect(vi.mocked(consumeQuery).mock.calls.length).toBe(callsBefore);
  });
});
