/**
 * Storage layer tests — encrypt/decrypt round-trips, key derivation, and
 * consent hash helper.  No IPFS network calls (upload/download are covered
 * by integration tests against a live node).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';

// Set a deterministic master key for tests.
const TEST_MASTER_KEY = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_MASTER_KEY = TEST_MASTER_KEY;

import {
  deriveDatasetKey,
  encryptDataset,
  decryptDataset,
  hashConsentDocument,
} from './index';

describe('deriveDatasetKey', () => {
  it('returns a 32-byte Buffer', () => {
    const key = deriveDatasetKey(1n);
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it('returns different keys for different dataset ids', () => {
    const k1 = deriveDatasetKey(1n);
    const k2 = deriveDatasetKey(2n);
    expect(k1.equals(k2)).toBe(false);
  });

  it('returns the same key for the same dataset id', () => {
    const k1 = deriveDatasetKey(42n);
    const k2 = deriveDatasetKey(42n);
    expect(k1.equals(k2)).toBe(true);
  });
});

describe('encryptDataset / decryptDataset round-trip', () => {
  it('recovers original plaintext', () => {
    const plaintext = Buffer.from('Hello, DataCommons!');
    const datasetId = 1n;
    const blob = encryptDataset(plaintext, datasetId);
    const recovered = decryptDataset(blob, datasetId);
    expect(recovered.equals(plaintext)).toBe(true);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const plaintext = Buffer.from('same content');
    const b1 = encryptDataset(plaintext, 1n);
    const b2 = encryptDataset(plaintext, 1n);
    // IVs should differ (randomised per encrypt call).
    expect(b1.iv.equals(b2.iv)).toBe(false);
  });

  it('fails to decrypt with the wrong dataset id', () => {
    const plaintext = Buffer.from('sensitive data');
    const blob = encryptDataset(plaintext, 1n);
    // Derived key for id 2 is different → GCM auth tag fails.
    expect(() => decryptDataset(blob, 2n)).toThrow();
  });

  it('fails to decrypt with a tampered ciphertext', () => {
    const plaintext = Buffer.from('authentic data');
    const blob = encryptDataset(plaintext, 1n);
    // Flip one byte in the ciphertext.
    blob.ciphertext[0] ^= 0xff;
    expect(() => decryptDataset(blob, 1n)).toThrow();
  });

  it('handles large payloads', () => {
    const plaintext = crypto.randomBytes(1_024 * 1_024); // 1 MB
    const blob = encryptDataset(plaintext, 99n);
    const recovered = decryptDataset(blob, 99n);
    expect(recovered.equals(plaintext)).toBe(true);
  });
});

describe('hashConsentDocument', () => {
  it('returns a 32-byte Buffer', () => {
    const hash = hashConsentDocument(Buffer.from('IRB approval document text'));
    expect(hash.length).toBe(32);
  });

  it('returns a deterministic hash', () => {
    const doc = Buffer.from('signed consent form');
    expect(hashConsentDocument(doc).equals(hashConsentDocument(doc))).toBe(true);
  });

  it('returns different hashes for different documents', () => {
    const h1 = hashConsentDocument(Buffer.from('doc A'));
    const h2 = hashConsentDocument(Buffer.from('doc B'));
    expect(h1.equals(h2)).toBe(false);
  });
});
