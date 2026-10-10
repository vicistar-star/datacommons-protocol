# Architecture — DataCommons Protocol

This document describes the system architecture of DataCommons Protocol as built in the Phase 1 MVP.

---

## Overview

DataCommons Protocol is a decentralised data licensing marketplace built on Stellar/Soroban. Its core value proposition is the combination of:

- **On-chain licensing and revenue splitting** — every purchase atomically pays contributors.
- **On-chain consent and provenance trail** — every dataset registration, purchase, query, and revocation is an immutable ledger event.
- **Off-chain data storage** — actual dataset bytes stay encrypted in IPFS/Arweave; the chain governs *access rights*, not storage.

---

## Component Map

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React + TypeScript, Vite)                        │
│                                                             │
│  MarketplacePage  DatasetDetailPage  MyLicensesPage         │
│  RegisterDatasetPage                                        │
│                                                             │
│  WalletContext (Stellar Wallets Kit — Freighter primary)    │
│  api.ts hooks → REST calls to Backend                       │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP (REST)
┌──────────────────────────▼──────────────────────────────────┐
│  Backend (Node.js + TypeScript + Express)                   │
│                                                             │
│  api/datasets.ts     GET/POST /datasets, PATCH confirm      │
│  api/licenses.ts     POST /licenses/build-purchase          │
│                      POST /licenses/purchase                │
│                      GET  /licenses/mine                    │
│  api/query.ts        POST /query/:licenseId                 │
│  api/datasets.ts     GET  /provenance/:datasetId            │
│                                                             │
│  chain/client.ts     Soroban RPC wrappers                   │
│  storage/index.ts    AES-256-GCM encrypt/decrypt + IPFS     │
│  db/migrate.ts       Postgres schema                        │
│  db/pool.ts          pg Pool                                │
└──────────────┬────────────────────────┬─────────────────────┘
               │ Soroban RPC            │ pg
┌──────────────▼──────────────┐  ┌──────▼──────────────────────┐
│  Stellar / Soroban           │  │  PostgreSQL                 │
│                              │  │                             │
│  DatasetRegistry contract    │  │  datasets table             │
│  LicenseToken contract       │  │  contributors table         │
│  (RevenueSplit library)      │  │  licenses table (cache)     │
│  USDC stablecoin contract    │  └─────────────────────────────┘
└─────────────────────────────┘
               │
┌──────────────▼──────────────┐
│  IPFS / Arweave              │
│  (encrypted dataset blobs)   │
└─────────────────────────────┘
```

---

## Data Flow

### Dataset Registration

1. Researcher fills out the **Register Dataset** form (metadata, contributors, price, access terms, consent document).
2. Browser hashes the consent document (SHA-256) client-side — only the hash leaves the browser.
3. Frontend calls `POST /datasets` → backend validates, stores off-chain metadata in Postgres, and calls `buildRegisterDatasetTx` to construct the unsigned Soroban transaction XDR.
4. Backend returns the unsigned XDR to the frontend.
5. Researcher signs via their Stellar wallet (Freighter).
6. Signed XDR is submitted on-chain; the `DatasetRegistry.register_dataset` call emits **provenance event #1** (`DatasetRegistered`).
7. Frontend calls `PATCH /datasets/:id/confirm` with the on-chain contract dataset ID to link the Postgres record to the chain record.

### License Purchase

1. Buyer views a dataset on the **Dataset Detail** page.
2. Buyer clicks "Buy" → frontend calls `POST /licenses/build-purchase` (backend builds unsigned purchase XDR).
3. Buyer signs via their Stellar wallet.
4. Signed XDR is submitted on-chain; `LicenseToken.purchase` atomically:
   - Reads the dataset's contributor table and price from `DatasetRegistry`.
   - Transfers USDC from the buyer to the contract.
   - Splits the payment across every contributor per their basis-point share (via `RevenueSplit`).
   - Mints a `LicenseRecord` with `expires_at` and/or `queries_remaining`.
   - Emits **provenance event #2** (`LicensePurchased`).
5. Frontend calls `POST /licenses/purchase` with the signed XDR → backend confirms on-chain, extracts the license ID from the transaction result, and inserts a row into the `licenses` cache table.

### Query-Based Access

1. Buyer visits **My Licenses** and selects a query-based license.
2. Buyer submits a query (count / sample / filter).
3. Frontend calls `POST /query/:licenseId` on the backend proxy.
4. Backend calls `check_access` on-chain — must return `Active`.
5. Backend calls `consume_query` on-chain (signed with `BACKEND_SIGNING_KEY`) — decrements `queries_remaining`, emits **provenance event #3** (`QueryConsumed`).
6. Backend downloads and decrypts the dataset from IPFS (key derived from `ENCRYPTION_MASTER_KEY` + dataset ID, released only after step 4 succeeds).
7. Backend executes the query server-side and returns only the result — the raw dataset bytes are never sent to the buyer.

### Time-Boxed Access

Same purchase flow as above.  For time-boxed licenses the buyer receives a decryption key (out-of-band, not shown in MVP UI) after backend verifies `check_access` returns `Active`.  The backend re-checks on every access attempt, not only at first download (per README Security Considerations).

### Revocation

Dataset owner calls `LicenseToken.revoke(license_id)` → contract marks the license revoked, emits **provenance event #4** (`LicenseRevoked`).  Subsequent `check_access` calls return `Revoked`; the backend proxy rejects all further queries immediately.

---

## On-Chain vs. Off-Chain Split

| Stored on-chain | Stored off-chain |
|---|---|
| Consent hash (`BytesN<32>`) | Actual consent/IRB document |
| Contributor splits (basis points) | Dataset files (AES-256-GCM encrypted) |
| Price and access terms | Rich metadata (title, description, schema) |
| License ownership, expiry, query counters | Search/discovery index (Postgres) |
| Immutable event log | Query proxy logic and rate-limiting UX |

This split keeps transaction costs low and avoids placing any personally identifiable or sensitive raw data on a public ledger.

---

## Security Properties

- **No raw data on-chain.** Only hashes and terms are recorded.
- **Decryption keys are only released after on-chain license verification.** The backend derives a per-dataset key from `ENCRYPTION_MASTER_KEY` + `dataset_id` using HKDF-SHA256, and never exposes this key without first confirming `check_access → Active`.
- **Every access attempt re-checks the chain.** The backend does not cache access status beyond a single request.
- **`consume_query` is authenticated.** Only the registered `backend_addr` (set at contract initialization) may decrement query counters — this is enforced by `require_auth` inside the contract.
- **Revenue splits are immutable.** Contributor shares are set once at dataset registration and cannot be changed, eliminating the risk of a silent post-purchase split modification.

---

## Postgres Schema (off-chain cache)

```
datasets
  id                  SERIAL PK
  contract_dataset_id BIGINT UNIQUE       ← on-chain id from DatasetRegistry
  owner_address       TEXT
  title, description  TEXT
  metadata_uri        TEXT                ← IPFS CID of encrypted blob
  consent_hash        TEXT                ← hex SHA-256
  price               BIGINT              ← stablecoin micro-units
  duration_secs       BIGINT NULL
  max_queries         INT NULL
  schema_preview      JSONB NULL
  category            TEXT NULL
  created_at          TIMESTAMPTZ

contributors
  id          SERIAL PK
  dataset_id  INT FK → datasets
  address     TEXT
  basis_points INT
  label       TEXT NULL

licenses
  id                   SERIAL PK
  contract_license_id  BIGINT UNIQUE      ← on-chain id from LicenseToken
  dataset_id           INT FK → datasets
  buyer_address        TEXT
  expires_at           TIMESTAMPTZ NULL
  queries_remaining    INT NULL
  revoked              BOOLEAN
  last_synced_at       TIMESTAMPTZ
  created_at           TIMESTAMPTZ
```

The Postgres tables serve as a fast read cache for the marketplace UI. The on-chain state (via `check_access`) is always the authoritative source for access decisions.
