# Data & Consent Provenance — DataCommons Protocol

This document describes how DataCommons Protocol creates and preserves an auditable provenance and consent trail for every dataset, license, and access event.

---

## Why Provenance Matters

For health, agricultural, and climate research data — especially data originating from communities in the Global South — provenance and informed consent are not optional extras. They are:

- **Ethical requirements.** IRB/ethics board approvals specify who can access data, under what terms, and for how long. A broken consent chain can invalidate a study.
- **Legal requirements.** Data protection laws in many jurisdictions require demonstrable records of consent, lawful basis for processing, and chain of custody.
- **Funder requirements.** Grant agencies increasingly require data management plans that include access controls and audit trails.
- **Community trust.** Indigenous and community datasets in particular require that data stewards can demonstrate, to the originating community, exactly who accessed the data and under what terms.

Existing arrangements — institutional data-sharing agreements stored in email threads, manual payment reconciliation in spreadsheets — provide none of this at scale. DataCommons Protocol moves the provenance record onto an immutable public ledger.

---

## The Four Provenance Events

Every dataset in the protocol generates an immutable on-chain event log. The four event types, in order of occurrence, are:

### 1. `DatasetRegistered`

Emitted by: `DatasetRegistry.register_dataset`

```
Topic: (REGISTRY, Register)
Data:  (dataset_id: u64, owner: Address, consent_hash: BytesN<32>)
```

**What this proves:**
- A specific dataset was registered by a specific owner address at a specific ledger timestamp.
- A specific consent/IRB document (identified by its SHA-256 hash) was acknowledged at registration time.
- The contributor revenue split was declared publicly and immutably at this moment.

**Off-chain anchor:** The actual consent document (signed IRB approval, community data-sharing agreement, etc.) is stored off-chain (in the metadata store or IPFS) with only its SHA-256 hash committed on-chain. This means any auditor can verify that a specific document existed at registration time without the platform needing to expose the document publicly.

### 2. `LicensePurchased`

Emitted by: `LicenseToken.purchase`

```
Topic: (LICENSE, Purchase)
Data:  (license_id: u64, dataset_id: u64, buyer: Address)
```

**What this proves:**
- A specific buyer paid for a license to a specific dataset at a specific ledger timestamp.
- The payment was split automatically among contributors per the registered split table — no manual invoicing, no opportunity for a platform operator to divert funds.
- The license terms (duration / query allowance) were set at the moment of purchase from the dataset's registered access terms.

### 3. `QueryConsumed`

Emitted by: `LicenseToken.consume_query`

```
Topic: (LICENSE, Query)
Data:  (license_id: u64,)
```

**What this proves:**
- A specific license was used to access data at a specific ledger timestamp.
- The access was authorised (the contract checks `AccessStatus == Active` before emitting).
- The backend service (identified by its `backend_addr` registered at contract initialisation) performed the access.

This event is emitted once per query for query-metered licenses, providing a complete, auditable access log.

### 4. `LicenseRevoked`

Emitted by: `LicenseToken.revoke`

```
Topic: (LICENSE, Revoke)
Data:  (license_id: u64,)
```

**What this proves:**
- A specific license was revoked by the dataset owner at a specific ledger timestamp.
- All subsequent `check_access` calls for this license will return `Revoked`.
- No further queries can be authorised for this license.

This is the primary mechanism for implementing consent withdrawal (e.g., a community withdrawing data-sharing consent, or an IRB revoking access).

---

## What the Consent Hash Covers and Does Not Cover

| ✅ Covered | ❌ Not covered |
|---|---|
| Proves a specific document existed at registration time | Proves the document was legitimately signed |
| Allows independent verification (hash the document, compare) | Prevents a bad actor from uploading a falsified document |
| Creates a tamper-evident anchor on the public ledger | Replaces actual ethics board oversight |

The consent hash is a **cryptographic commitment**, not a legal substitute for proper ethics processes. It provides the technical infrastructure for auditability; the ethical validity of the consent process itself remains the responsibility of the dataset owner and their institutional review body.

---

## Who Can Audit the Provenance Trail

The full event log for any dataset is publicly readable from the Stellar ledger. No trust in the platform operator is required. Auditors can:

1. Use the **`GET /provenance/:datasetId`** API endpoint to get a structured view of all events for a dataset (the backend fetches this from the Soroban RPC event log).
2. Query the Soroban RPC directly using the contract IDs (documented in `docs/testnet-deployment.md`).
3. Use any Stellar block explorer that supports Soroban event indexing.

The platform operator cannot alter or delete events once they are confirmed on the ledger.

---

## Limitations and Disclosures

- **Already-downloaded time-boxed data cannot be technically unshared.** If a buyer has already downloaded and decrypted a file for a time-boxed license, revoking the license on-chain prevents further downloads but cannot delete data the buyer already holds. This limitation should be disclosed clearly in licensing terms. (Query-based licenses are more revocation-robust because the raw file is never released to the buyer.)
- **The platform operator controls the query proxy.** For query-based licenses, the backend's `BACKEND_SIGNING_KEY` can call `consume_query`. If the backend is compromised, an attacker could consume query credits without returning results. Key rotation and tight scoping of the backend signing key are documented in the Security Considerations section of README.md.
- **The Postgres cache can lag the chain.** The `licenses` table in Postgres is a cache. `GET /licenses/mine` live-checks `check_access` on every call to mitigate this, but bulk historical queries go to the cache. Always use the on-chain event log for definitive provenance, not the Postgres cache.
