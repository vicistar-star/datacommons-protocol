/**
 * Encrypted off-chain storage client.
 *
 * Datasets are stored encrypted in IPFS. The symmetric key is derived per
 * dataset from the ENCRYPTION_MASTER_KEY and the dataset id, and is only
 * released to a buyer after on-chain license verification (see README
 * Security Considerations).
 *
 * In the MVP the IPFS interaction uses the HTTP API (IPFS Infura gateway
 * configured via env vars).  Arweave support is a straightforward swap of
 * the upload/download functions.
 */

import 'dotenv/config';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';

function getMasterKey(): Buffer {
  const key = process.env.ENCRYPTION_MASTER_KEY;
  if (!key) throw new Error('ENCRYPTION_MASTER_KEY is not set');
  // Accept raw hex (64 chars = 32 bytes) or base64.
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, 'hex');
  }
  const buf = Buffer.from(key, 'base64');
  if (buf.length !== 32) throw new Error('ENCRYPTION_MASTER_KEY must be 32 bytes (hex or base64)');
  return buf;
}

/**
 * Derive a dataset-specific 256-bit symmetric key from the master key
 * and the dataset id, using HKDF-SHA256.
 */
export function deriveDatasetKey(datasetId: bigint): Buffer {
  const master = getMasterKey();
  const info = Buffer.from(`datacommons-dataset-${datasetId}`);
  return Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(32), info, 32));
}

// ---------------------------------------------------------------------------
// Encryption / decryption
// ---------------------------------------------------------------------------

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;         // 12 bytes for GCM
  authTag: Buffer;    // 16 bytes for GCM
}

export function encryptDataset(plaintext: Buffer, datasetId: bigint): EncryptedBlob {
  const key = deriveDatasetKey(datasetId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decryptDataset(blob: EncryptedBlob, datasetId: bigint): Buffer {
  const key = deriveDatasetKey(datasetId);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, blob.iv);
  decipher.setAuthTag(blob.authTag);
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
}

// ---------------------------------------------------------------------------
// IPFS upload / download
// ---------------------------------------------------------------------------

function ipfsApiUrl(): string {
  return process.env.IPFS_API_URL ?? 'https://ipfs.infura.io:5001';
}

function ipfsAuthHeader(): string {
  const projectId = process.env.IPFS_PROJECT_ID ?? '';
  const secret = process.env.IPFS_PROJECT_SECRET ?? '';
  return `Basic ${Buffer.from(`${projectId}:${secret}`).toString('base64')}`;
}

/**
 * Upload an encrypted blob to IPFS. Returns the CID.
 *
 * The blob is stored as a single file with IV + authTag prepended so the
 * download path can reconstruct the EncryptedBlob without side-channel
 * metadata storage.
 *
 * Layout: [4 bytes magic "DCP\x01"] [12 bytes IV] [16 bytes authTag] [ciphertext]
 */
export async function uploadEncryptedToIPFS(blob: EncryptedBlob): Promise<string> {
  const magic = Buffer.from('DCP\x01');
  const payload = Buffer.concat([magic, blob.iv, blob.authTag, blob.ciphertext]);

  const form = new FormData();
  form.append('file', new Blob([payload]), 'dataset.enc');

  const res = await fetch(`${ipfsApiUrl()}/api/v0/add?pin=true`, {
    method: 'POST',
    headers: { Authorization: ipfsAuthHeader() },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`IPFS upload failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { Hash: string };
  return json.Hash;
}

/**
 * Download and parse an encrypted blob from IPFS by CID.
 */
export async function downloadEncryptedFromIPFS(cid: string): Promise<EncryptedBlob> {
  const res = await fetch(`${ipfsApiUrl()}/api/v0/cat?arg=${cid}`, {
    method: 'POST',
    headers: { Authorization: ipfsAuthHeader() },
  });

  if (!res.ok) {
    throw new Error(`IPFS download failed: ${res.status} ${await res.text()}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  // Validate magic.
  if (buf.slice(0, 4).toString() !== 'DCP\x01') {
    throw new Error('Invalid encrypted blob magic');
  }
  const iv = buf.slice(4, 16);
  const authTag = buf.slice(16, 32);
  const ciphertext = buf.slice(32);
  return { ciphertext, iv, authTag };
}

/**
 * Helper: encrypt a dataset file and upload it to IPFS.
 * Returns the IPFS CID of the encrypted blob.
 */
export async function encryptAndUpload(plaintext: Buffer, datasetId: bigint): Promise<string> {
  const blob = encryptDataset(plaintext, datasetId);
  return uploadEncryptedToIPFS(blob);
}

/**
 * Helper: download and decrypt a dataset file from IPFS.
 * Only called after on-chain license verification (see query proxy / key
 * release logic in the API layer).
 */
export async function downloadAndDecrypt(cid: string, datasetId: bigint): Promise<Buffer> {
  const blob = await downloadEncryptedFromIPFS(cid);
  return decryptDataset(blob, datasetId);
}

// ---------------------------------------------------------------------------
// Consent hash helper
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hash of a consent document buffer.
 * Returns a 32-byte Buffer ready to send on-chain as BytesN<32>.
 */
export function hashConsentDocument(document: Buffer): Buffer {
  return crypto.createHash('sha256').update(document).digest();
}
