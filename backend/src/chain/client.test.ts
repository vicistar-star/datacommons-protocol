/**
 * Chain client unit tests — mock the Soroban RPC server so these run without
 * a live network connection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @stellar/stellar-sdk before importing the module under test
// ---------------------------------------------------------------------------
vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();

  class FakeServer {
    async getAccount(address: string) {
      return {
        accountId: () => address,
        sequenceNumber: () => '100',
        incrementSequenceNumber: () => {},
      };
    }
    async simulateTransaction(_tx: unknown) {
      // Return a fake successful simulation with a dummy retval.
      return {
        result: {
          retval: actual.xdr.ScVal.scvBool(true),
        },
      };
    }
    async sendTransaction(_tx: unknown) {
      return { status: 'PENDING', hash: 'deadbeef' };
    }
    async getTransaction(hash: string) {
      return { status: actual.rpc.Api.GetTransactionStatus.SUCCESS, hash };
    }
    async prepareTransaction(tx: unknown) {
      return tx as { toXDR: () => string } & { sign: (_kp: unknown) => void };
    }
    async getEvents(_params: unknown) {
      return { events: [] };
    }
  }

  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: FakeServer,
      Api: {
        ...actual.rpc.Api,
        isSimulationError: (_r: unknown) => false,
        GetTransactionStatus: {
          SUCCESS: 'SUCCESS',
          FAILED: 'FAILED',
          NOT_FOUND: 'NOT_FOUND',
        },
      },
    },
  };
});

import {
  registryContractId,
  licenseContractId,
  stablecoinContractId,
  getProvenanceEvents,
  checkAccess,
} from './client';

describe('chain/client config helpers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws if DATASET_REGISTRY_CONTRACT_ID is not set', () => {
    const orig = process.env.DATASET_REGISTRY_CONTRACT_ID;
    delete process.env.DATASET_REGISTRY_CONTRACT_ID;
    expect(() => registryContractId()).toThrow('DATASET_REGISTRY_CONTRACT_ID');
    process.env.DATASET_REGISTRY_CONTRACT_ID = orig;
  });

  it('returns the contract id when env var is set', () => {
    process.env.DATASET_REGISTRY_CONTRACT_ID = 'CTEST_REGISTRY';
    expect(registryContractId()).toBe('CTEST_REGISTRY');
  });

  it('throws if LICENSE_TOKEN_CONTRACT_ID is not set', () => {
    const orig = process.env.LICENSE_TOKEN_CONTRACT_ID;
    delete process.env.LICENSE_TOKEN_CONTRACT_ID;
    expect(() => licenseContractId()).toThrow('LICENSE_TOKEN_CONTRACT_ID');
    process.env.LICENSE_TOKEN_CONTRACT_ID = orig;
  });

  it('throws if STABLECOIN_CONTRACT_ID is not set', () => {
    const orig = process.env.STABLECOIN_CONTRACT_ID;
    delete process.env.STABLECOIN_CONTRACT_ID;
    expect(() => stablecoinContractId()).toThrow('STABLECOIN_CONTRACT_ID');
    process.env.STABLECOIN_CONTRACT_ID = orig;
  });
});

describe('getProvenanceEvents', () => {
  it('returns an empty array when RPC returns no events', async () => {
    process.env.DATASET_REGISTRY_CONTRACT_ID = 'CTEST_REG';
    process.env.LICENSE_TOKEN_CONTRACT_ID = 'CTEST_LIC';
    const events = await getProvenanceEvents(1n);
    expect(events).toEqual([]);
  });
});
