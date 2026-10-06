# DataCommons Protocol

**A decentralized data licensing marketplace for researchers, built on Stellar/Soroban.**

DataCommons Protocol lets researchers in health, agriculture, and climate science — especially in the Global South, where data infrastructure and monetization channels are weakest — mint verifiable access tokens for their datasets, license them to universities and companies for stablecoin payment, and have revenue split automatically and transparently among every contributor, with a full on-chain provenance and consent trail.

---

## Table of Contents

1. [Problem & Solution](#problem--solution)
2. [Key Features](#key-features)
3. [Design Decisions](#design-decisions)
4. [Architecture](#architecture)
5. [Smart Contract Design](#smart-contract-design)
6. [Data & Consent Provenance](#data--consent-provenance)
7. [Tech Stack](#tech-stack)
8. [Repository Structure](#repository-structure)
9. [Getting Started](#getting-started)
10. [Environment Variables](#environment-variables)
11. [API Reference (Backend)](#api-reference-backend)
12. [Testing](#testing)
13. [Deployment](#deployment)
14. [Security Considerations](#security-considerations)
15. [Roadmap](#roadmap)
16. [Contributing](#contributing)
17. [License](#license)
18. [Acknowledgments](#acknowledgments)

---

## Problem & Solution

### The Problem

Researchers in health, agricultural, and climate science across the Global South generate enormous amounts of valuable field, clinical, sensor, and survey data. But they largely lack:

- **A legal/technical mechanism to license access** without giving away full, unrestricted copies of their data.
- **A way to monetize** that data fairly — most current arrangements are informal, one-off, and favor whoever has institutional leverage (typically funders or partner universities in the Global North).
- **Provenance and consent trails** that hold up to scrutiny — critical for health and indigenous/community data, where informed consent and chain-of-custody are not optional.
- **Fair multi-contributor revenue splitting** — field teams, co-authors, community data stewards, and institutions all contribute, but existing payment rails make it hard to split revenue transparently and automatically.

### The Solution

DataCommons Protocol is a marketplace where:

1. **Dataset owners mint access tokens** (Soroban smart contract tokens) representing a license to a dataset, with terms encoded on-chain: duration, query limits, price, and revenue split among contributors.
2. **Buyers (universities, companies, NGOs) pay in stablecoin** (e.g., USDC on Stellar) to acquire a time-boxed or query-metered license.
3. **The smart contract enforces the license terms** and **auto-splits revenue** to every listed contributor/co-author at the moment of payment — no manual invoicing, no trust required.
4. **Every mint, license purchase, and access event is logged on-chain**, creating an immutable consent and provenance trail that can be audited by ethics boards, funders, or the original data subjects' communities.
5. **Actual dataset bytes stay off-chain** (encrypted, in IPFS/Arweave/private storage) — the chain governs *access rights*, not storage, keeping costs low and jurisdictional data-residency concerns manageable.

---

## Key Features

- 🔑 **License NFTs** — each purchased license is a non-fungible token representing a specific buyer's rights to a specific dataset.
- ⏱ **Hybrid access control** — dataset owners choose, per listing, whether access is **time-boxed** (N days from purchase), **query-metered** (N queries/pulls), or **both** (whichever limit is hit first).
- 💰 **Automatic revenue splitting** — every license payment is split on-chain, in the same transaction, across all registered contributors according to fixed percentages set at mint time.
- 📜 **On-chain provenance & consent trail** — dataset registration requires a consent hash (e.g., hash of a signed consent/IRB document); every license event is an immutable, timestamped ledger entry.
- 🌍 **Stablecoin-denominated pricing** — prices are set and paid in a stablecoin (default: USDC on Stellar) to insulate researchers from local currency volatility.
- 🧾 **Auditable by design** — funders, ethics boards, or communities can independently verify who accessed what data, when, under what terms, and who got paid what, without trusting a central intermediary.
- 🔌 **Query-proxy backend** — for query-based licenses, the backend enforces metering and proxies queries to the underlying dataset without ever releasing the raw file to the buyer.
- 🪪 **Wallet-based identity** — researchers and buyers authenticate via Stellar wallets (Freighter, Albedo, etc.); no centralized account database holding sensitive credentials.

---

## Design Decisions

These were the two open design questions for the first build, resolved as follows:

### 1. Access Control Model: **Hybrid (time-boxed + query-metered, buyer's choice)**

Rather than picking one model, the contract supports both because the two research buyer types need different things:

| Model | Best for | Enforcement |
|---|---|---|
| **Time-boxed** | Buyers who need unrestricted analysis for a fixed research period (e.g., a 90-day grant-funded study) | Contract stores `expires_at` (ledger timestamp); access checked against current ledger time |
| **Query-metered** | Buyers who need occasional, specific pulls (e.g., a one-off statistical query) without full dataset exposure | Contract stores `queries_remaining`; backend decrements on each proxied query via a contract call |

A dataset owner sets **one or both** limits per listing. If both are set, access ends when *either* limit is reached — this is enforced identically whether it's a strict time cap, a strict query cap, or a combined cap, so the contract logic doesn't need special-casing per listing.

### 2. Revenue Split Model: **Fixed percentages, set once at mint, with an upgrade path**

For the first version, contributor splits are:

- Declared **at dataset-mint time** as a list of `(address, basis_points)` pairs summing to 10,000 (100.00%).
- **Immutable once minted**, deliberately. This is the simplest model to reason about and audit — no governance process, no risk of a split being silently changed after a buyer has already paid into it, and it maps cleanly to how research co-authorship and community-data-steward agreements are usually settled before publication/licensing begins anyway.
- Enforced **atomically in the same transaction** as the buyer's payment — funds never sit in an intermediate pooled balance waiting for a manual payout.

**Upgrade path (Phase 2, see [Roadmap](#roadmap)):** a `SplitRegistry` pattern where a dataset's split list is itself a versioned, owner-governed sub-record, allowing new contributors to be added for *future* licenses while past purchases remain governed by the split that was active when they were bought. This is deliberately deferred — editable splits introduce real questions (who can edit, what happens to licenses already sold, how disputes are arbitrated) that are easier to get right once the fixed-split version is live and battle-tested.

---

## Architecture

```mermaid
flowchart TB
    subgraph Frontend["Frontend (React)"]
        UI[Marketplace UI]
        Wallet[Wallet Connect<br/>Freighter/Albedo]
    end

    subgraph Backend["Backend (Node/TypeScript)"]
        API[REST/GraphQL API]
        Meta[Dataset Metadata Store]
        Proxy[Query Proxy & Metering]
        IPFS[Encrypted Storage<br/>IPFS/Arweave]
    end

    subgraph Chain["Stellar / Soroban"]
        Registry[DatasetRegistry Contract]
        License[LicenseToken Contract]
        Split[RevenueSplit Logic]
        USDC[Stablecoin<br/>USDC Token Contract]
    end

    UI --> API
    UI --> Wallet
    Wallet --> Chain
    API --> Meta
    API --> Proxy
    Proxy --> IPFS
    Proxy -->|verify access| License
    API --> Registry
    License --> Split
    Split --> USDC
    Registry -->|consent hash, dataset id| Meta
```

**Flow summary:**

1. Researcher registers a dataset off-chain (metadata, encrypted file pointer) and on-chain (`DatasetRegistry`: consent hash, contributor splits, pricing/access terms).
2. Buyer browses the marketplace (frontend, backed by the metadata API) and initiates a purchase.
3. Buyer's wallet signs a Soroban transaction calling `LicenseToken.purchase()`, paying in USDC.
4. The contract **atomically**: mints a license NFT to the buyer, splits the USDC payment across contributors per the dataset's split table, and records the license terms (expiry / query allowance).
5. For time-boxed licenses, the buyer accesses data directly (decryption key released once license is verified). For query-based licenses, the backend proxy checks remaining-queries on-chain before each pull, decrements it via a contract call, and returns only the queried result.

---

## Smart Contract Design

### Contracts

**`DatasetRegistry`**
- `register_dataset(owner, metadata_uri, consent_hash, contributors: Vec<(Address, u32)>, price, access_terms) -> DatasetId`
- `get_dataset(id) -> DatasetInfo`
- Validates `contributors` basis points sum to 10,000.
- Emits `DatasetRegistered` event (immutable provenance entry #1).

**`LicenseToken`** (NFT-like, one token instance per purchase)
- `purchase(dataset_id, buyer, payment_token) -> LicenseId`
  - Transfers stablecoin from buyer to contract.
  - Splits payment per `DatasetRegistry` contributor table, in the same call.
  - Mints license record: `{ license_id, dataset_id, buyer, expires_at: Option<u64>, queries_remaining: Option<u32> }`.
  - Emits `LicensePurchased` event (provenance entry #2).
- `check_access(license_id) -> AccessStatus` — read-only; used by the backend proxy before serving data.
- `consume_query(license_id)` — decrements `queries_remaining`; callable only by the registered backend service address; emits `QueryConsumed` event.
- `revoke(license_id)` — dataset owner can revoke on consent withdrawal (health-data requirement); emits `LicenseRevoked` event.

**`RevenueSplit`** (library/module, not a separate deployed contract in the MVP)
- Pure function: given a payment amount and a contributor table, computes per-address transfer amounts, handling rounding remainder deterministically (remainder to dataset owner).

### On-chain vs. off-chain

| On-chain | Off-chain |
|---|---|
| Consent hash, contributor splits, price, access terms | Actual dataset files (encrypted) |
| License ownership, expiry, query counters | Rich metadata (title, description, schema, sample rows) |
| Payment + revenue split execution | Search/discovery index |
| Immutable event log (register/purchase/consume/revoke) | Query proxy logic and rate limiting UX |

This keeps gas costs low and avoids putting any personally identifiable or sensitive raw data on a public ledger — only its *hash* and *licensing terms* live on-chain.

---

## Data & Consent Provenance

Given the health/agri/climate research context, provenance isn't a nice-to-have — it's the core value proposition. Every dataset registration requires:

- A **consent hash**: SHA-256 of a signed consent form, IRB/ethics approval document, or community data-sharing agreement, stored off-chain (e.g., in the metadata store or IPFS) with only its hash committed on-chain. This proves *a* specific document existed at *a* specific time without exposing potentially sensitive consent details publicly.
- A **contributor list**, so co-authorship and revenue rights are declared up front, not negotiated after money changes hands.
- An **immutable event log** (register → purchase → query/access → revoke) that any auditor, funder, ethics board, or data-subject community can independently verify against the chain — no need to trust the platform operator's database.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contracts | Rust, Soroban SDK |
| Chain | Stellar (Testnet/Futurenet for dev, Mainnet for production) |
| Stablecoin | USDC (Stellar Anchor-issued) or other SEP-41-compliant token |
| Backend | Node.js, TypeScript, Express or Fastify, PostgreSQL (metadata), Redis (query-rate caching) |
| Off-chain storage | IPFS or Arweave (encrypted blobs), with symmetric key release gated by license verification |
| Frontend | React, TypeScript, Vite, Stellar Wallets Kit (Freighter/Albedo/Lobstr) |
| Contract tooling | Soroban CLI, `soroban-sdk`, `stellar-cli` |
| Testing | Rust unit/integration tests (contracts), Vitest/Jest (backend & frontend), Soroban local sandbox |

---

## Repository Structure

```
datacommons-protocol/
├── contracts/
│   ├── dataset-registry/
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   ├── license-token/
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   ├── revenue-split/
│   │   └── src/lib.rs          # shared library crate
│   └── Cargo.toml               # workspace root
├── backend/
│   ├── src/
│   │   ├── api/                 # REST routes: datasets, licenses, users
│   │   ├── chain/               # Soroban RPC client, contract bindings
│   │   ├── proxy/                # query metering & data proxy
│   │   ├── storage/              # IPFS/Arweave client, encryption
│   │   └── db/                   # Postgres models/migrations
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── pages/                # Marketplace, Dataset Detail, My Licenses, Register Dataset
│   │   ├── components/
│   │   ├── wallet/                # Stellar wallet connection
│   │   └── hooks/
│   ├── package.json
│   └── vite.config.ts
├── scripts/
│   ├── deploy_contracts.sh
│   └── seed_testnet_data.ts
├── docs/
│   ├── architecture.md
│   ├── contract-spec.md
│   └── consent-provenance.md
├── .env.example
└── README.md
```

---

## Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable) + `wasm32-unknown-unknown` target
- [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup)
- Node.js ≥ 18 and npm/pnpm
- PostgreSQL ≥ 14
- A funded Stellar Testnet account ([Friendbot](https://friendbot.stellar.org))
- A Stellar wallet browser extension (Freighter recommended) for local testing

### 1. Clone and install

```bash
git clone https://github.com/<your-org>/datacommons-protocol.git
cd datacommons-protocol

# Contracts
rustup target add wasm32-unknown-unknown

# Backend
cd backend && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..
```

### 2. Build and deploy contracts (Testnet)

```bash
cd contracts
soroban contract build

soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/dataset_registry.wasm \
  --source <your-identity> \
  --network testnet

soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/license_token.wasm \
  --source <your-identity> \
  --network testnet
```

Save the resulting contract IDs into `backend/.env` and `frontend/.env`.

### 3. Run the backend

```bash
cd backend
cp .env.example .env   # fill in DB + contract + storage config
npm run migrate
npm run dev
```

### 4. Run the frontend

```bash
cd frontend
cp .env.example .env   # fill in API URL + contract IDs
npm run dev
```

Visit `http://localhost:5173`.

---

## Environment Variables

**`backend/.env`**

```
DATABASE_URL=postgres://user:pass@localhost:5432/datacommons
STELLAR_NETWORK=testnet
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
DATASET_REGISTRY_CONTRACT_ID=
LICENSE_TOKEN_CONTRACT_ID=
STABLECOIN_CONTRACT_ID=
BACKEND_SIGNING_KEY=          # used only for consume_query calls
IPFS_API_URL=
IPFS_PROJECT_ID=
IPFS_PROJECT_SECRET=
ENCRYPTION_MASTER_KEY=
```

**`frontend/.env`**

```
VITE_API_URL=http://localhost:4000
VITE_STELLAR_NETWORK=testnet
VITE_DATASET_REGISTRY_CONTRACT_ID=
VITE_LICENSE_TOKEN_CONTRACT_ID=
VITE_STABLECOIN_CONTRACT_ID=
```

---

## API Reference (Backend)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/datasets` | List/search datasets (metadata, price, access terms) |
| `GET` | `/datasets/:id` | Dataset detail (schema, sample, contributor list, consent hash) |
| `POST` | `/datasets` | Register dataset metadata off-chain (paired with on-chain `register_dataset`) |
| `POST` | `/licenses/purchase` | Submit signed purchase transaction, confirm on-chain, unlock access |
| `GET` | `/licenses/mine` | Buyer's active/expired licenses |
| `POST` | `/query/:licenseId` | Proxy a metered query against a dataset (query-based licenses only) |
| `GET` | `/provenance/:datasetId` | Full on-chain event history for a dataset (register/purchase/query/revoke) |

Full OpenAPI spec: `docs/api-spec.yaml` (generated as the backend stabilizes).

---

## Testing

```bash
# Contracts
cd contracts && cargo test

# Backend
cd backend && npm test

# Frontend
cd frontend && npm test
```

Contract tests run against the Soroban local sandbox and cover: split-sum validation, atomic payment+split execution, expiry enforcement, query-metering decrement, and revocation.

---

## Deployment

| Environment | Chain network | Purpose |
|---|---|---|
| Local | Soroban sandbox | Contract unit tests |
| Staging | Stellar Testnet/Futurenet | Integration testing, demo |
| Production | Stellar Mainnet | Live licensing with real stablecoin payments |

Deployment scripts live in `scripts/deploy_contracts.sh`; backend/frontend deploy via standard CI (GitHub Actions workflow to be added in `.github/workflows/`).

---

## Security Considerations

- **No raw data on-chain** — only hashes and licensing terms, minimizing exposure of sensitive research/consent data.
- **Backend proxy is a trusted component** for query-metered access (it must call `consume_query`); its signing key must be tightly scoped and rotated regularly.
- **Encryption keys for time-boxed licenses** are released only after on-chain license verification, and access should be re-checked periodically (not just once at download) to respect expiry.
- **Consent hash ≠ consent content** — the platform never stores or displays raw consent/IRB documents publicly; only their hash is committed on-chain for verifiability.
- **Revocation** must propagate promptly to the query proxy and any cached decryption keys on the buyer side (a documented limitation: already-downloaded time-boxed data can't be technically "unshared," which should be disclosed clearly in licensing terms).
- Independent contract audit recommended before Mainnet launch, given real stablecoin funds flow through `LicenseToken.purchase()`.

---

## Roadmap

- [x] Design: hybrid access control model
- [x] Design: fixed-split revenue model
- [ ] Phase 1 (MVP): `DatasetRegistry` + `LicenseToken` contracts, backend metadata/query-proxy, marketplace frontend
- [ ] Phase 2: Editable/versioned contributor splits (`SplitRegistry`)
- [ ] Phase 3: Reputation/rating system for datasets and buyers
- [ ] Phase 4: Multi-stablecoin support and local on/off-ramp partnerships for Global South researchers
- [ ] Phase 5: DAO-style dispute resolution for consent/revocation conflicts
- [ ] Phase 6: Federated query execution (analysis runs where data lives, never leaves origin infrastructure)

---

## Contributing

Contributions are welcome. Please open an issue to discuss significant changes before submitting a PR, and ensure `cargo test` / `npm test` pass across all workspaces. See `docs/CONTRIBUTING.md` (to be added) for coding standards and commit conventions.

---

## License

This project's code is intended to be released under the **Apache 2.0** license (confirm/finalize with contributors before public release). Datasets listed on the marketplace remain the property of their registered owners/contributors under the terms each dataset's license specifies — the protocol license does not extend to user-submitted data.

---

## Acknowledgments

Built for researchers whose data work too often goes uncredited and unpaid. Designed with particular attention to the needs of health, agricultural, and climate researchers operating in the Global South, where data monetization and consent infrastructure are least mature and most needed.
