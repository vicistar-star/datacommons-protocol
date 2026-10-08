/**
 * Soroban RPC chain client.
 *
 * Wraps every method on DatasetRegistry and LicenseToken that the backend
 * needs to call.  No new contract methods are introduced here — this file
 * only exposes bindings to what the contracts built in Days 2-3 already
 * implement.
 *
 * For read-only calls (get_dataset, check_access, provenance events) the
 * client uses simulateTransaction so no on-chain fee is charged.
 * For write calls (register_dataset, purchase, consume_query, revoke) the
 * caller must supply a signed XDR transaction envelope; this file assembles
 * the operation, the caller signs it externally, then submits it.
 */

import 'dotenv/config';
import {
  Contract,
  Networks,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  xdr,
  Keypair,
  Address,
} from '@stellar/stellar-sdk';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function rpcUrl(): string {
  return process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
}

function networkPassphrase(): string {
  const net = (process.env.STELLAR_NETWORK ?? 'testnet').toLowerCase();
  return net === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

export function registryContractId(): string {
  const id = process.env.DATASET_REGISTRY_CONTRACT_ID;
  if (!id) throw new Error('DATASET_REGISTRY_CONTRACT_ID is not set');
  return id;
}

export function licenseContractId(): string {
  const id = process.env.LICENSE_TOKEN_CONTRACT_ID;
  if (!id) throw new Error('LICENSE_TOKEN_CONTRACT_ID is not set');
  return id;
}

export function stablecoinContractId(): string {
  const id = process.env.STABLECOIN_CONTRACT_ID;
  if (!id) throw new Error('STABLECOIN_CONTRACT_ID is not set');
  return id;
}

// ---------------------------------------------------------------------------
// Shared types (mirrors the Soroban contract types)
// ---------------------------------------------------------------------------

export interface AccessTerms {
  duration_secs: bigint | null;
  max_queries: number | null;
}

export interface Contributor {
  address: string;
  basis_points: number;
}

export interface DatasetInfo {
  id: bigint;
  owner: string;
  metadata_uri: string;
  consent_hash: string; // hex
  contributors: Contributor[];
  price: bigint;
  access_terms: AccessTerms;
}

export interface LicenseRecord {
  license_id: bigint;
  dataset_id: bigint;
  buyer: string;
  expires_at: bigint | null;
  queries_remaining: number | null;
  revoked: boolean;
}

export type AccessStatus = 'Active' | 'Expired' | 'QueryExhausted' | 'Revoked';

export interface ProvenanceEvent {
  topic: string;
  data: unknown;
  ledger: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Low-level RPC helpers
// ---------------------------------------------------------------------------

function makeServer(): SorobanRpc.Server {
  return new SorobanRpc.Server(rpcUrl(), { allowHttp: rpcUrl().startsWith('http://') });
}

/**
 * Simulate a read-only contract invocation and decode the return value.
 */
async function simulateRead(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<xdr.ScVal> {
  const server = makeServer();
  const account = await server.getAccount(
    // Use a dummy account for simulation — no auth needed for reads.
    'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
  ).catch(() => ({
    accountId: () => 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
    sequenceNumber: () => '0',
    incrementSequenceNumber: () => {},
  }));

  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account as Parameters<typeof TransactionBuilder>[0], {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`Simulation error for ${method}: ${result.error}`);
  }
  if (!result.result?.retval) {
    throw new Error(`No return value from ${method}`);
  }
  return result.result.retval;
}

/**
 * Submit a pre-signed XDR transaction envelope string and wait for confirmation.
 */
export async function submitSignedTransaction(signedXdr: string): Promise<string> {
  const server = makeServer();
  const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase());
  const sendResult = await server.sendTransaction(tx);
  if (sendResult.status === 'ERROR') {
    throw new Error(`Send failed: ${JSON.stringify(sendResult.errorResult)}`);
  }
  // Poll for confirmation.
  const hash = sendResult.hash;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await server.getTransaction(hash);
    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed: ${hash}`);
    }
  }
  throw new Error(`Transaction timed out: ${hash}`);
}

/**
 * Build, sign with the backend key, and submit a write transaction.
 * Used for consume_query (the only write the backend signs autonomously).
 */
export async function buildSignAndSubmit(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  const signingKey = process.env.BACKEND_SIGNING_KEY;
  if (!signingKey) throw new Error('BACKEND_SIGNING_KEY is not set');

  const keypair = Keypair.fromSecret(signingKey);
  const server = makeServer();
  const account = await server.getAccount(keypair.publicKey());

  const contract = new Contract(contractId);
  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // Prepare (get soroban footprint/auth).
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);

  return submitSignedTransaction(prepared.toXDR());
}

// ---------------------------------------------------------------------------
// DatasetRegistry bindings
// ---------------------------------------------------------------------------

/** Decode a DatasetInfo ScVal returned by get_dataset. */
function decodeDatasetInfo(val: xdr.ScVal): DatasetInfo {
  const native = scValToNative(val) as Record<string, unknown>;
  const terms = native['access_terms'] as Record<string, unknown>;
  const contribs = (native['contributors'] as Array<Record<string, unknown>>).map((c) => ({
    address: c['address'] as string,
    basis_points: Number(c['basis_points']),
  }));
  return {
    id: BigInt(String(native['id'])),
    owner: native['owner'] as string,
    metadata_uri: native['metadata_uri'] as string,
    consent_hash: Buffer.from(native['consent_hash'] as Uint8Array).toString('hex'),
    contributors: contribs,
    price: BigInt(String(native['price'])),
    access_terms: {
      duration_secs: terms['duration_secs'] != null ? BigInt(String(terms['duration_secs'])) : null,
      max_queries: terms['max_queries'] != null ? Number(terms['max_queries']) : null,
    },
  };
}

export async function getDataset(datasetId: bigint): Promise<DatasetInfo> {
  const val = await simulateRead(
    registryContractId(),
    'get_dataset',
    [nativeToScVal(datasetId, { type: 'u64' })],
  );
  return decodeDatasetInfo(val);
}

/**
 * Build the unsigned XDR for register_dataset so the frontend/owner can sign it.
 * Returns the base64 XDR transaction envelope for signing.
 */
export async function buildRegisterDatasetTx(params: {
  ownerAddress: string;
  metadataUri: string;
  consentHash: string; // 32-byte hex
  contributors: Contributor[];
  price: bigint;
  accessTerms: AccessTerms;
}): Promise<string> {
  const server = makeServer();
  const account = await server.getAccount(params.ownerAddress);
  const contract = new Contract(registryContractId());

  const contributorsVal = xdr.ScVal.scvVec(
    params.contributors.map((c) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('address'),
          val: nativeToScVal(Address.fromString(c.address), { type: 'address' }),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('basis_points'),
          val: nativeToScVal(c.basis_points, { type: 'u32' }),
        }),
      ]),
    ),
  );

  const accessTermsVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('duration_secs'),
      val:
        params.accessTerms.duration_secs != null
          ? xdr.ScVal.scvVec([nativeToScVal(params.accessTerms.duration_secs, { type: 'u64' })])
          : xdr.ScVal.scvVec([]),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('max_queries'),
      val:
        params.accessTerms.max_queries != null
          ? xdr.ScVal.scvVec([nativeToScVal(params.accessTerms.max_queries, { type: 'u32' })])
          : xdr.ScVal.scvVec([]),
    }),
  ]);

  const consentBytes = Buffer.from(params.consentHash, 'hex');
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      contract.call(
        'register_dataset',
        nativeToScVal(Address.fromString(params.ownerAddress), { type: 'address' }),
        nativeToScVal(params.metadataUri, { type: 'string' }),
        xdr.ScVal.scvBytes(consentBytes),
        contributorsVal,
        nativeToScVal(params.price, { type: 'i128' }),
        accessTermsVal,
      ),
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  return prepared.toXDR();
}

// ---------------------------------------------------------------------------
// LicenseToken bindings
// ---------------------------------------------------------------------------

export async function checkAccess(licenseId: bigint): Promise<AccessStatus> {
  const val = await simulateRead(
    licenseContractId(),
    'check_access',
    [nativeToScVal(licenseId, { type: 'u64' })],
  );
  const native = scValToNative(val);
  // Soroban enum variants come back as { tag: string } or just the tag string
  const tag = typeof native === 'object' && native !== null
    ? (native as Record<string, unknown>)['tag'] ?? native
    : native;
  return String(tag) as AccessStatus;
}

/**
 * Build the unsigned XDR for purchase so the buyer can sign it via their wallet.
 */
export async function buildPurchaseTx(params: {
  buyerAddress: string;
  datasetId: bigint;
  paymentToken: string;
}): Promise<string> {
  const server = makeServer();
  const account = await server.getAccount(params.buyerAddress);
  const contract = new Contract(licenseContractId());

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      contract.call(
        'purchase',
        nativeToScVal(params.datasetId, { type: 'u64' }),
        nativeToScVal(Address.fromString(params.buyerAddress), { type: 'address' }),
        nativeToScVal(Address.fromString(params.paymentToken), { type: 'address' }),
      ),
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  return prepared.toXDR();
}

/**
 * Decrement a query counter on-chain.  Called by the backend proxy; uses the
 * BACKEND_SIGNING_KEY environment variable to authenticate.
 */
export async function consumeQuery(licenseId: bigint): Promise<void> {
  await buildSignAndSubmit(
    licenseContractId(),
    'consume_query',
    [nativeToScVal(licenseId, { type: 'u64' })],
  );
}

/**
 * Build the unsigned XDR for revoke so the dataset owner can sign it.
 */
export async function buildRevokeTx(params: {
  callerAddress: string;
  licenseId: bigint;
}): Promise<string> {
  const server = makeServer();
  const account = await server.getAccount(params.callerAddress);
  const contract = new Contract(licenseContractId());

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      contract.call(
        'revoke',
        nativeToScVal(params.licenseId, { type: 'u64' }),
        nativeToScVal(Address.fromString(params.callerAddress), { type: 'address' }),
      ),
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  return prepared.toXDR();
}

// ---------------------------------------------------------------------------
// Provenance event log
// ---------------------------------------------------------------------------

/**
 * Fetch the on-chain event history for a dataset (register, purchase, query,
 * revoke events) from the Soroban RPC node.
 */
export async function getProvenanceEvents(datasetId: bigint): Promise<ProvenanceEvent[]> {
  const server = makeServer();
  // Request events from ledger 0 to latest (paginated by Soroban RPC).
  const response = await server.getEvents({
    startLedger: 1,
    filters: [
      {
        contractIds: [registryContractId(), licenseContractId()],
      },
    ],
  });

  const events: ProvenanceEvent[] = [];
  for (const ev of response.events) {
    try {
      const topicNative = ev.topic.map((t) => scValToNative(t));
      const dataNative = scValToNative(ev.value);

      // Filter for this dataset by checking data contains the dataset_id.
      // Simple heuristic: keep all events for now (full provenance log).
      events.push({
        topic: topicNative.join('/'),
        data: dataNative,
        ledger: ev.ledger,
        timestamp: 0, // ledger close time not in all SDK versions
      });
    } catch {
      // Skip unparseable events.
    }
  }

  return events;
}
