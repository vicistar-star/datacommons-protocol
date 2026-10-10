/**
 * api.ts — thin fetch wrappers around the backend REST API.
 *
 * All functions throw on non-2xx responses. BigInt fields come back as
 * strings from the backend (JSON.stringify can't serialise BigInt natively).
 */

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

// ---------------------------------------------------------------------------
// Types matching backend response shapes
// ---------------------------------------------------------------------------

export interface ContributorDTO {
  address: string;
  basis_points: number;
  label: string | null;
}

export interface DatasetDTO {
  id: number;
  contract_dataset_id: string | null;
  owner_address: string;
  title: string;
  description: string;
  metadata_uri: string;
  consent_hash: string;
  price: string;
  duration_secs: string | null;
  max_queries: number | null;
  schema_preview: unknown;
  category: string | null;
  created_at: string;
  contributors: ContributorDTO[];
}

export interface DatasetListResponse {
  datasets: DatasetDTO[];
  page: number;
  limit: number;
}

export interface LicenseDTO {
  id: number;
  contract_license_id: string;
  dataset_id: number;
  buyer_address: string;
  expires_at: string | null;
  queries_remaining: number | null;
  revoked: boolean;
  live_status: string;
}

export interface QueryResult {
  license_id: string;
  dataset_id: string | null;
  query: unknown;
  result: unknown;
}

// ---------------------------------------------------------------------------
// Dataset endpoints
// ---------------------------------------------------------------------------

export async function fetchDatasets(
  params: { q?: string; category?: string; page?: number } = {},
): Promise<DatasetListResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.category) qs.set('category', params.category);
  if (params.page) qs.set('page', String(params.page));
  const res = await fetch(`${API_URL}/datasets?${qs}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchDataset(id: string | number): Promise<DatasetDTO> {
  const res = await fetch(`${API_URL}/datasets/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface RegisterDatasetPayload {
  owner_address: string;
  title: string;
  description?: string;
  metadata_uri: string;
  consent_hash: string;
  price: string;
  duration_secs?: string | null;
  max_queries?: number | null;
  contributors: Array<{ address: string; basis_points: number; label?: string }>;
  schema_preview?: unknown;
  category?: string;
}

export async function registerDataset(
  payload: RegisterDatasetPayload,
): Promise<{ dataset_id: number; unsigned_xdr: string; message: string }> {
  const res = await fetch(`${API_URL}/datasets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function confirmDatasetRegistration(
  dbId: number,
  contractDatasetId: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/datasets/${dbId}/confirm`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contract_dataset_id: contractDatasetId }),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ---------------------------------------------------------------------------
// License endpoints
// ---------------------------------------------------------------------------

export async function buildPurchaseTx(
  datasetContractId: string,
  buyerAddress: string,
): Promise<string> {
  const stablecoin =
    (import.meta.env.VITE_STABLECOIN_CONTRACT_ID as string | undefined) ?? '';
  const res = await fetch(`${API_URL}/licenses/build-purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dataset_contract_id: datasetContractId,
      buyer_address: buyerAddress,
      payment_token: stablecoin,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json() as { unsigned_xdr: string };
  return data.unsigned_xdr;
}

export async function confirmPurchase(
  signedXdr: string,
  buyerAddress: string,
  datasetId?: number,
): Promise<{ tx_hash: string; contract_license_id: string | null }> {
  const res = await fetch(`${API_URL}/licenses/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signed_xdr: signedXdr, buyer_address: buyerAddress, dataset_id: datasetId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchMyLicenses(walletAddress: string): Promise<LicenseDTO[]> {
  const res = await fetch(`${API_URL}/licenses/mine?wallet=${encodeURIComponent(walletAddress)}`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json() as { licenses: LicenseDTO[] };
  return data.licenses;
}

// ---------------------------------------------------------------------------
// Query proxy endpoint
// ---------------------------------------------------------------------------

export async function submitQuery(
  licenseId: string,
  query: { type: 'count' } | { type: 'sample'; n: number } | { type: 'filter'; field: string; value: string },
): Promise<QueryResult> {
  const res = await fetch(`${API_URL}/query/${encodeURIComponent(licenseId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
