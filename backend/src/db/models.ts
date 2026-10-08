/**
 * TypeScript interfaces mirroring the Postgres schema.
 * These are plain data types — no ORM, no active-record pattern.
 */

export interface DatasetRow {
  id: number;
  contract_dataset_id: string | null; // bigint → string in node-postgres
  owner_address: string;
  title: string;
  description: string;
  metadata_uri: string;
  consent_hash: string;
  price: string;           // bigint → string
  duration_secs: string | null;
  max_queries: number | null;
  schema_preview: unknown | null;
  category: string | null;
  created_at: Date;
}

export interface ContributorRow {
  id: number;
  dataset_id: number;
  address: string;
  basis_points: number;
  label: string | null;
}

export interface LicenseRow {
  id: number;
  contract_license_id: string; // bigint → string
  dataset_id: number;
  buyer_address: string;
  expires_at: Date | null;
  queries_remaining: number | null;
  revoked: boolean;
  last_synced_at: Date;
  created_at: Date;
}
