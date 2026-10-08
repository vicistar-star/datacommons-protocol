#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, BytesN, Env, String, Vec,
    symbol_short,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Hybrid access-control terms: time-boxed, query-metered, or both.
/// `None` on a field means that dimension is not limited.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AccessTerms {
    /// Maximum seconds the license is valid after purchase (time-boxed).
    pub duration_secs: Option<u64>,
    /// Maximum number of queries the buyer may execute (query-metered).
    pub max_queries: Option<u32>,
}

/// On-chain contributor entry: address + basis points share (0–10 000).
#[contracttype]
#[derive(Clone, Debug)]
pub struct Contributor {
    pub address: Address,
    /// Share in basis points (1/100 of a percent). All contributors in a
    /// dataset must sum to exactly 10 000.
    pub basis_points: u32,
}

/// Full dataset record stored on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DatasetInfo {
    pub id: u64,
    pub owner: Address,
    /// URI pointing to off-chain metadata (title, description, schema, …).
    pub metadata_uri: String,
    /// SHA-256 of the signed consent / IRB document (32-byte array).
    pub consent_hash: BytesN<32>,
    pub contributors: Vec<Contributor>,
    /// Price in stablecoin smallest unit (e.g. USDC stroops).
    pub price: i128,
    pub access_terms: AccessTerms,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    /// Monotonically increasing dataset counter → next id to assign.
    Counter,
    /// Maps dataset_id → DatasetInfo.
    Dataset(u64),
}

// ---------------------------------------------------------------------------
// Error codes (soroban contracterror — u32-backed, panic-by-contract)
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    /// contributor basis_points do not sum to exactly 10 000
    InvalidSplitSum = 1,
    /// contributor list is empty
    NoContributors = 2,
    /// dataset not found
    DatasetNotFound = 3,
    /// access_terms must have at least one limit set
    NoAccessTerms = 4,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct DatasetRegistry;

#[contractimpl]
impl DatasetRegistry {
    /// Register a new dataset. Returns the assigned dataset id.
    ///
    /// Validates that contributor basis_points sum to exactly 10 000 and that
    /// at least one access-control dimension is set. Emits `DatasetRegistered`.
    pub fn register_dataset(
        env: Env,
        owner: Address,
        metadata_uri: String,
        consent_hash: BytesN<32>,
        contributors: Vec<Contributor>,
        price: i128,
        access_terms: AccessTerms,
    ) -> u64 {
        // Require the caller to be the owner.
        owner.require_auth();

        // Must have at least one contributor.
        if contributors.is_empty() {
            env.panic_with_error(ContractError::NoContributors);
        }

        // Validate basis points sum to exactly 10 000 (100.00%).
        let mut sum: u32 = 0;
        for c in contributors.iter() {
            sum = sum.saturating_add(c.basis_points);
        }
        if sum != 10_000 {
            env.panic_with_error(ContractError::InvalidSplitSum);
        }

        // At least one access dimension must be set.
        if access_terms.duration_secs.is_none() && access_terms.max_queries.is_none() {
            env.panic_with_error(ContractError::NoAccessTerms);
        }

        // Assign a new id.
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0u64);
        let next_id = id + 1;

        let info = DatasetInfo {
            id: next_id,
            owner: owner.clone(),
            metadata_uri,
            consent_hash: consent_hash.clone(),
            contributors,
            price,
            access_terms,
        };

        env.storage().instance().set(&DataKey::Dataset(next_id), &info);
        env.storage().instance().set(&DataKey::Counter, &next_id);

        // Provenance log entry #1 — DatasetRegistered event.
        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("REGISTRY"), symbol_short!("Register")),
            (next_id, owner, consent_hash),
        );

        next_id
    }

    /// Read a dataset record by id. Panics with DatasetNotFound if missing.
    pub fn get_dataset(env: Env, id: u64) -> DatasetInfo {
        env.storage()
            .instance()
            .get(&DataKey::Dataset(id))
            .unwrap_or_else(|| env.panic_with_error(ContractError::DatasetNotFound))
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Events as _, Env, BytesN, String, Vec};

    fn make_env() -> Env {
        Env::default()
    }

    fn sample_contributors(env: &Env, owner: &Address) -> Vec<Contributor> {
        let mut v = Vec::new(env);
        v.push_back(Contributor {
            address: owner.clone(),
            basis_points: 7_000,
        });
        v.push_back(Contributor {
            address: Address::generate(env),
            basis_points: 3_000,
        });
        v
    }

    fn consent_hash(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[0u8; 32])
    }

    fn access_terms_time() -> AccessTerms {
        AccessTerms {
            duration_secs: Some(86_400),
            max_queries: None,
        }
    }

    fn access_terms_query() -> AccessTerms {
        AccessTerms {
            duration_secs: None,
            max_queries: Some(10),
        }
    }

    fn access_terms_both() -> AccessTerms {
        AccessTerms {
            duration_secs: Some(86_400),
            max_queries: Some(10),
        }
    }

    #[test]
    fn test_register_and_read_back() {
        let env = make_env();
        let contract_id = env.register(DatasetRegistry, ());
        let client = DatasetRegistryClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        env.mock_all_auths();

        let contributors = sample_contributors(&env, &owner);
        let id = client.register_dataset(
            &owner,
            &String::from_str(&env, "ipfs://meta1"),
            &consent_hash(&env),
            &contributors,
            &1_000_000i128,
            &access_terms_time(),
        );
        assert_eq!(id, 1);

        let info = client.get_dataset(&id);
        assert_eq!(info.id, 1);
        assert_eq!(info.price, 1_000_000);
        assert_eq!(info.access_terms.duration_secs, Some(86_400));
        assert_eq!(info.access_terms.max_queries, None);
    }

    #[test]
    fn test_sequential_ids() {
        let env = make_env();
        let contract_id = env.register(DatasetRegistry, ());
        let client = DatasetRegistryClient::new(&env, &contract_id);
        env.mock_all_auths();

        let owner = Address::generate(&env);
        let contributors = sample_contributors(&env, &owner);

        let id1 = client.register_dataset(
            &owner,
            &String::from_str(&env, "ipfs://meta1"),
            &consent_hash(&env),
            &contributors,
            &1_000i128,
            &access_terms_time(),
        );
        let id2 = client.register_dataset(
            &owner,
            &String::from_str(&env, "ipfs://meta2"),
            &consent_hash(&env),
            &contributors,
            &2_000i128,
            &access_terms_query(),
        );
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
    }

    #[test]
    #[should_panic]
    fn test_reject_invalid_split_sum() {
        let env = make_env();
        let contract_id = env.register(DatasetRegistry, ());
        let client = DatasetRegistryClient::new(&env, &contract_id);
        env.mock_all_auths();

        let owner = Address::generate(&env);
        let mut contributors = Vec::new(&env);
        contributors.push_back(Contributor {
            address: owner.clone(),
            basis_points: 5_000, // only 50 %, should panic
        });

        client.register_dataset(
            &owner,
            &String::from_str(&env, "ipfs://meta"),
            &consent_hash(&env),
            &contributors,
            &1_000i128,
            &access_terms_time(),
        );
    }

    #[test]
    #[should_panic]
    fn test_reject_empty_contributors() {
        let env = make_env();
        let contract_id = env.register(DatasetRegistry, ());
        let client = DatasetRegistryClient::new(&env, &contract_id);
        env.mock_all_auths();

        let owner = Address::generate(&env);
        let contributors: Vec<Contributor> = Vec::new(&env);

        client.register_dataset(
            &owner,
            &String::from_str(&env, "ipfs://meta"),
            &consent_hash(&env),
            &contributors,
            &1_000i128,
            &access_terms_time(),
        );
    }

    #[test]
    #[should_panic]
    fn test_reject_no_access_terms() {
        let env = make_env();
        let contract_id = env.register(DatasetRegistry, ());
        let client = DatasetRegistryClient::new(&env, &contract_id);
        env.mock_all_auths();

        let owner = Address::generate(&env);
        let contributors = sample_contributors(&env, &owner);

        client.register_dataset(
            &owner,
            &String::from_str(&env, "ipfs://meta"),
            &consent_hash(&env),
            &contributors,
            &1_000i128,
            &AccessTerms {
                duration_secs: None,
                max_queries: None,
            },
        );
    }

    #[test]
    #[should_panic]
    fn test_not_found() {
        let env = make_env();
        let contract_id = env.register(DatasetRegistry, ());
        let client = DatasetRegistryClient::new(&env, &contract_id);

        client.get_dataset(&999u64);
    }

    #[test]
    fn test_hybrid_access_terms() {
        let env = make_env();
        let contract_id = env.register(DatasetRegistry, ());
        let client = DatasetRegistryClient::new(&env, &contract_id);
        env.mock_all_auths();

        let owner = Address::generate(&env);
        let contributors = sample_contributors(&env, &owner);
        let terms = access_terms_both();

        let id = client.register_dataset(
            &owner,
            &String::from_str(&env, "ipfs://meta"),
            &consent_hash(&env),
            &contributors,
            &500i128,
            &terms,
        );

        let info = client.get_dataset(&id);
        assert_eq!(info.access_terms.duration_secs, Some(86_400));
        assert_eq!(info.access_terms.max_queries, Some(10));
    }

    #[test]
    fn test_event_emitted() {
        let env = make_env();
        let contract_id = env.register(DatasetRegistry, ());
        let client = DatasetRegistryClient::new(&env, &contract_id);
        env.mock_all_auths();

        let owner = Address::generate(&env);
        let contributors = sample_contributors(&env, &owner);

        let id = client.register_dataset(
            &owner,
            &String::from_str(&env, "ipfs://meta"),
            &consent_hash(&env),
            &contributors,
            &100i128,
            &access_terms_time(),
        );

        // Verify at least one event was published.
        let events = env.events().all();
        assert!(!events.events().is_empty(), "expected DatasetRegistered event");
        let _ = id; // id confirmed above
    }
}
