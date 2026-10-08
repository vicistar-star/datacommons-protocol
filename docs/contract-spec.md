# Contract Specification

DataCommons Protocol deploys two Soroban smart contracts and one shared library crate.

---

## 1. `DatasetRegistry`

**Crate:** `contracts/dataset-registry`  
**Purpose:** On-chain registration of datasets with consent hashes, contributor splits, pricing, and access terms.

### Types

#### `AccessTerms`
```rust
pub struct AccessTerms {
    pub duration_secs: Option<u64>,  // time-boxed limit in seconds; None = no time limit
    pub max_queries: Option<u32>,    // query-metered limit; None = no query limit
}
```
At least one field must be `Some` — a dataset must have at least one access-control dimension.

#### `Contributor`
```rust
pub struct Contributor {
    pub address: Address,
    pub basis_points: u32,   // share in basis points (1/100 of 1%)
}
```

#### `DatasetInfo`
```rust
pub struct DatasetInfo {
    pub id: u64,
    pub owner: Address,
    pub metadata_uri: String,    // URI to off-chain metadata (IPFS / Arweave)
    pub consent_hash: BytesN<32>, // SHA-256 of signed consent/IRB document
    pub contributors: Vec<Contributor>,
    pub price: i128,             // price in stablecoin smallest unit
    pub access_terms: AccessTerms,
}
```

### Methods

#### `register_dataset`
```rust
pub fn register_dataset(
    env: Env,
    owner: Address,
    metadata_uri: String,
    consent_hash: BytesN<32>,
    contributors: Vec<Contributor>,
    price: i128,
    access_terms: AccessTerms,
) -> u64
```
Registers a new dataset. Returns the assigned `dataset_id`.

**Validations:**
- `owner.require_auth()` — caller must be the owner.
- `contributors` must be non-empty.
- Sum of all `contributor.basis_points` must equal exactly `10,000`.
- `access_terms` must have at least one of `duration_secs` or `max_queries` set.

**Events emitted:**
- `(REGISTRY, Register)` → data: `(dataset_id: u64, owner: Address, consent_hash: BytesN<32>)`  
  This is **provenance log entry #1**.

#### `get_dataset`
```rust
pub fn get_dataset(env: Env, id: u64) -> DatasetInfo
```
Read-only accessor. Panics with `DatasetNotFound` if the id does not exist.

### Error Codes

| Code | Value | Meaning |
|---|---|---|
| `InvalidSplitSum` | 1 | Contributor basis points do not sum to 10,000 |
| `NoContributors` | 2 | Contributor list is empty |
| `DatasetNotFound` | 3 | No dataset with that id |
| `NoAccessTerms` | 4 | Neither `duration_secs` nor `max_queries` is set |

---

## 2. `LicenseToken`

**Crate:** `contracts/license-token`  
**Purpose:** License purchase with atomic revenue split, access enforcement, query metering, and revocation.

### Initialisation

Must be called once after deployment:

```rust
pub fn initialize(env: Env, registry_addr: Address, backend_addr: Address)
```

- `registry_addr` — address of the deployed `DatasetRegistry` contract.
- `backend_addr` — address of the backend service account allowed to call `consume_query`.

### Types

#### `AccessStatus`
```rust
pub enum AccessStatus {
    Active,
    Expired,
    QueryExhausted,
    Revoked,
}
```

#### `LicenseRecord`
```rust
pub struct LicenseRecord {
    pub license_id: u64,
    pub dataset_id: u64,
    pub buyer: Address,
    pub expires_at: Option<u64>,        // ledger timestamp; None = no time limit
    pub queries_remaining: Option<u32>, // None = no query limit
    pub revoked: bool,
}
```

### Methods

#### `purchase`
```rust
pub fn purchase(
    env: Env,
    dataset_id: u64,
    buyer: Address,
    payment_token: Address,
) -> u64
```
Atomically:
1. Reads the dataset's contributor table and price from `DatasetRegistry`.
2. Transfers `price` from `buyer` to this contract (stablecoin token transfer).
3. Computes per-contributor splits via `RevenueSplit::compute_splits`.
4. Transfers each split amount from this contract to each contributor.
5. Mints a `LicenseRecord` with `expires_at` and/or `queries_remaining` derived from the dataset's `AccessTerms`.
6. Emits `LicensePurchased` event.

**Events emitted:**
- `(LICENSE, Purchase)` → data: `(license_id: u64, dataset_id: u64, buyer: Address)`  
  This is **provenance log entry #2**.

#### `check_access`
```rust
pub fn check_access(env: Env, license_id: u64) -> AccessStatus
```
Read-only. Returns the current `AccessStatus` of a license:
- `Revoked` — if `record.revoked == true`.
- `Expired` — if `ledger.timestamp() >= record.expires_at`.
- `QueryExhausted` — if `record.queries_remaining == Some(0)`.
- `Active` — otherwise.

Checked in this order; the first matching condition wins.

#### `consume_query`
```rust
pub fn consume_query(env: Env, license_id: u64)
```
Decrements `queries_remaining` by 1. Enforces:
- `backend_addr.require_auth()` — only the registered backend service may call this.
- `check_access` must return `Active`; otherwise panics with `AccessDenied`.

**Events emitted:**
- `(LICENSE, Query)` → data: `(license_id: u64,)`  
  This is **provenance log entry #3**.

#### `revoke`
```rust
pub fn revoke(env: Env, license_id: u64, caller: Address)
```
Marks the license as revoked. Enforces:
- `caller.require_auth()`.
- `caller` must be the dataset owner (verified via `DatasetRegistry.get_dataset`).
- License must not already be revoked.

**Events emitted:**
- `(LICENSE, Revoke)` → data: `(license_id: u64,)`  
  This is **provenance log entry #4**.

### Error Codes

| Code | Value | Meaning |
|---|---|---|
| `LicenseNotFound` | 1 | No license with that id |
| `AccessDenied` | 2 | License is not Active (expired, exhausted, or revoked) |
| `UnauthorizedCaller` | 3 | Caller is not authorized for this operation |
| `AlreadyRevoked` | 4 | License is already revoked |
| `NotInitialized` | 5 | Contract has not been initialized |

---

## 3. `RevenueSplit` (library)

**Crate:** `contracts/revenue-split`  
**Purpose:** Pure-function revenue split computation. Not deployed as a contract — used as a dependency inside `LicenseToken`.

### Function

```rust
pub fn compute_splits(payment: i128, basis_points: &[u32]) -> Vec<Payout>
```

Computes per-contributor payout amounts:
- Each contributor `i` receives `floor(payment * basis_points[i] / 10_000)`.
- Any rounding remainder is added to `payouts[0]` (the dataset owner / first contributor).
- The sum of all `payout.amount` values equals `payment` exactly.

#### `Payout`
```rust
pub struct Payout {
    pub contributor_index: usize,  // index into the input basis_points slice
    pub amount: i128,
}
```

---

## On-chain Event Log (Provenance Trail)

Every operation that creates or changes a license emits a Soroban event, forming the immutable provenance trail described in README.md.

| Entry | Event key | Data |
|---|---|---|
| #1 Dataset registered | `(REGISTRY, Register)` | `(dataset_id, owner, consent_hash)` |
| #2 License purchased | `(LICENSE, Purchase)` | `(license_id, dataset_id, buyer)` |
| #3 Query consumed | `(LICENSE, Query)` | `(license_id,)` |
| #4 License revoked | `(LICENSE, Revoke)` | `(license_id,)` |

Auditors, ethics boards, and data-subject communities can read this log directly from the Stellar ledger without trusting the platform operator.

---

## On-chain vs. Off-chain Data Summary

| Stored on-chain | Stored off-chain |
|---|---|
| Consent hash (`BytesN<32>`) | Actual consent/IRB document |
| Contributor splits (basis points) | Dataset files (encrypted) |
| Price and access terms | Rich metadata (title, description, schema) |
| License ownership, expiry, query counters | Search/discovery index |
| Immutable event log | Query proxy logic and rate-limiting UX |
