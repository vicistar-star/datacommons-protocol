#![no_std]

extern crate alloc;

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    token::Client as TokenClient,
    Address, Env,
    symbol_short,
};

use dataset_registry::{DatasetRegistryClient, Contributor};
use revenue_split::compute_splits;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Status returned by check_access.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum AccessStatus {
    /// Access is currently valid.
    Active,
    /// License has passed its expiry timestamp.
    Expired,
    /// Query allowance has been exhausted.
    QueryExhausted,
    /// License was revoked by the dataset owner.
    Revoked,
}

/// On-chain license record minted at purchase time.
#[contracttype]
#[derive(Clone, Debug)]
pub struct LicenseRecord {
    pub license_id: u64,
    pub dataset_id: u64,
    pub buyer: Address,
    /// Unix timestamp (ledger seconds) when the license expires.
    /// None means time-unlimited (only query-metered limit applies).
    pub expires_at: Option<u64>,
    /// Remaining query count.
    /// None means no query limit (only time-boxed limit applies).
    pub queries_remaining: Option<u32>,
    pub revoked: bool,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    /// Monotonically increasing license counter.
    Counter,
    /// License record by id.
    License(u64),
    /// Address of the DatasetRegistry contract.
    RegistryAddr,
    /// Address of the backend service allowed to call consume_query.
    BackendAddr,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    LicenseNotFound = 1,
    AccessDenied = 2,
    UnauthorizedCaller = 3,
    AlreadyRevoked = 4,
    NotInitialized = 5,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct LicenseToken;

#[contractimpl]
impl LicenseToken {
    // -----------------------------------------------------------------------
    // Admin / initialisation
    // -----------------------------------------------------------------------

    /// Set the addresses of the DatasetRegistry contract and the backend
    /// signing address.  Must be called once after deployment.
    pub fn initialize(env: Env, registry_addr: Address, backend_addr: Address) {
        env.storage().instance().set(&DataKey::RegistryAddr, &registry_addr);
        env.storage().instance().set(&DataKey::BackendAddr, &backend_addr);
    }

    // -----------------------------------------------------------------------
    // Purchase
    // -----------------------------------------------------------------------

    /// Purchase a license for `dataset_id`.
    ///
    /// Atomically:
    /// 1. Reads the dataset's contributor table and price from DatasetRegistry.
    /// 2. Transfers payment from `buyer` to this contract.
    /// 3. Splits payment to each contributor via RevenueSplit.
    /// 4. Mints a license record.
    /// 5. Emits `LicensePurchased`.
    ///
    /// Returns the new license id.
    pub fn purchase(
        env: Env,
        dataset_id: u64,
        buyer: Address,
        payment_token: Address,
    ) -> u64 {
        buyer.require_auth();

        let registry_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::RegistryAddr)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NotInitialized));

        let registry = DatasetRegistryClient::new(&env, &registry_addr);
        let dataset = registry.get_dataset(&dataset_id);

        let price = dataset.price;
        let token = TokenClient::new(&env, &payment_token);

        // Transfer full price from buyer to this contract.
        token.transfer(&buyer, &env.current_contract_address(), &price);

        // Compute splits using the RevenueSplit library.
        // Collect basis_points into a plain Rust slice for the pure library.
        let bps_vec: alloc::vec::Vec<u32> = dataset
            .contributors
            .iter()
            .map(|c| c.basis_points)
            .collect();
        let payouts = compute_splits(price, &bps_vec);

        // Transfer each payout from this contract to each contributor.
        let contributors_vec: alloc::vec::Vec<Contributor> = dataset
            .contributors
            .iter()
            .collect();
        for payout in &payouts {
            if payout.amount > 0 {
                let addr = &contributors_vec[payout.contributor_index].address;
                token.transfer(
                    &env.current_contract_address(),
                    addr,
                    &payout.amount,
                );
            }
        }

        // Mint the license record.
        let license_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0u64)
            + 1;

        let now = env.ledger().timestamp();
        let expires_at = dataset.access_terms.duration_secs.map(|d| now + d);
        let queries_remaining = dataset.access_terms.max_queries;

        let record = LicenseRecord {
            license_id,
            dataset_id,
            buyer: buyer.clone(),
            expires_at,
            queries_remaining,
            revoked: false,
        };

        env.storage().instance().set(&DataKey::License(license_id), &record);
        env.storage().instance().set(&DataKey::Counter, &license_id);

        // Provenance log entry #2 — LicensePurchased event.
        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("LICENSE"), symbol_short!("Purchase")),
            (license_id, dataset_id, buyer),
        );

        license_id
    }

    // -----------------------------------------------------------------------
    // Access enforcement
    // -----------------------------------------------------------------------

    /// Read-only check: returns the current access status of a license.
    pub fn check_access(env: Env, license_id: u64) -> AccessStatus {
        let record: LicenseRecord = env
            .storage()
            .instance()
            .get(&DataKey::License(license_id))
            .unwrap_or_else(|| env.panic_with_error(ContractError::LicenseNotFound));

        if record.revoked {
            return AccessStatus::Revoked;
        }

        if let Some(exp) = record.expires_at {
            if env.ledger().timestamp() >= exp {
                return AccessStatus::Expired;
            }
        }

        if let Some(q) = record.queries_remaining {
            if q == 0 {
                return AccessStatus::QueryExhausted;
            }
        }

        AccessStatus::Active
    }

    // -----------------------------------------------------------------------
    // Query metering
    // -----------------------------------------------------------------------

    /// Decrement the query counter for a license.
    ///
    /// Only callable by the registered backend service address.
    /// Panics with AccessDenied if the license is not currently active.
    /// Emits `QueryConsumed`.
    pub fn consume_query(env: Env, license_id: u64) {
        // Authenticate the backend service address.
        let backend_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::BackendAddr)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NotInitialized));
        backend_addr.require_auth();

        let mut record: LicenseRecord = env
            .storage()
            .instance()
            .get(&DataKey::License(license_id))
            .unwrap_or_else(|| env.panic_with_error(ContractError::LicenseNotFound));

        // Verify access is currently active.
        let status = Self::check_access(env.clone(), license_id);
        if status != AccessStatus::Active {
            env.panic_with_error(ContractError::AccessDenied);
        }

        // Decrement query counter if applicable.
        if let Some(q) = record.queries_remaining {
            record.queries_remaining = Some(q - 1);
            env.storage().instance().set(&DataKey::License(license_id), &record);
        }

        // Provenance log entry #3 — QueryConsumed event.
        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("LICENSE"), symbol_short!("Query")),
            (license_id,),
        );
    }

    // -----------------------------------------------------------------------
    // Revocation
    // -----------------------------------------------------------------------

    /// Revoke a license. Only callable by the dataset owner (verified via
    /// DatasetRegistry). Emits `LicenseRevoked`.
    pub fn revoke(env: Env, license_id: u64, caller: Address) {
        caller.require_auth();

        let record: LicenseRecord = env
            .storage()
            .instance()
            .get(&DataKey::License(license_id))
            .unwrap_or_else(|| env.panic_with_error(ContractError::LicenseNotFound));

        if record.revoked {
            env.panic_with_error(ContractError::AlreadyRevoked);
        }

        // Verify caller is the dataset owner.
        let registry_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::RegistryAddr)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NotInitialized));
        let registry = DatasetRegistryClient::new(&env, &registry_addr);
        let dataset = registry.get_dataset(&record.dataset_id);

        if dataset.owner != caller {
            env.panic_with_error(ContractError::UnauthorizedCaller);
        }

        let revoked_record = LicenseRecord {
            revoked: true,
            ..record
        };
        env.storage()
            .instance()
            .set(&DataKey::License(license_id), &revoked_record);

        // Provenance log entry #4 — LicenseRevoked event.
        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("LICENSE"), symbol_short!("Revoke")),
            (license_id,),
        );
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Address, BytesN, Env, String, Vec,
    };
    use dataset_registry::{
        AccessTerms, Contributor, DatasetRegistry, DatasetRegistryClient,
    };

    /// Mint a test stablecoin and fund an address.
    fn setup_token(env: &Env, funder: &Address, amount: i128) -> Address {
        let token_admin = Address::generate(env);
        let token_addr = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
        let admin_client = StellarAssetClient::new(env, &token_addr);
        admin_client.mint(funder, &amount);
        token_addr
    }

    fn register_dataset(
        env: &Env,
        registry_id: &Address,
        owner: &Address,
        price: i128,
        duration_secs: Option<u64>,
        max_queries: Option<u32>,
    ) -> u64 {
        let registry = DatasetRegistryClient::new(env, registry_id);
        let mut contributors = Vec::new(env);
        contributors.push_back(Contributor {
            address: owner.clone(),
            basis_points: 10_000,
        });
        registry.register_dataset(
            owner,
            &String::from_str(env, "ipfs://meta"),
            &BytesN::from_array(env, &[0u8; 32]),
            &contributors,
            &price,
            &AccessTerms { duration_secs, max_queries },
        )
    }

    #[test]
    fn test_purchase_and_split() {
        let env = Env::default();
        env.mock_all_auths();

        // Deploy registry and license-token.
        let registry_id = env.register(DatasetRegistry, ());
        let license_id_contract = env.register(LicenseToken, ());
        let client = LicenseTokenClient::new(&env, &license_id_contract);

        let backend = Address::generate(&env);
        client.initialize(&registry_id, &backend);

        // Register a dataset owned 70/30 split between two contributors.
        let owner = Address::generate(&env);
        let collab = Address::generate(&env);
        let registry = DatasetRegistryClient::new(&env, &registry_id);
        let mut contributors = Vec::new(&env);
        contributors.push_back(Contributor { address: owner.clone(), basis_points: 7_000 });
        contributors.push_back(Contributor { address: collab.clone(), basis_points: 3_000 });
        let dataset_id = registry.register_dataset(
            &owner,
            &String::from_str(&env, "ipfs://meta"),
            &BytesN::from_array(&env, &[0u8; 32]),
            &contributors,
            &1_000_000i128,
            &AccessTerms { duration_secs: Some(86_400), max_queries: None },
        );

        // Fund the buyer.
        let buyer = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer, 1_000_000);

        let lic_id = client.purchase(&dataset_id, &buyer, &token_addr);
        assert_eq!(lic_id, 1);

        // Verify splits arrived at contributors.
        let token = TokenClient::new(&env, &token_addr);
        assert_eq!(token.balance(&owner), 700_000);
        assert_eq!(token.balance(&collab), 300_000);
        assert_eq!(token.balance(&buyer), 0);
    }

    #[test]
    fn test_check_access_active() {
        let env = Env::default();
        env.mock_all_auths();

        let registry_id = env.register(DatasetRegistry, ());
        let lt_id = env.register(LicenseToken, ());
        let client = LicenseTokenClient::new(&env, &lt_id);
        let backend = Address::generate(&env);
        client.initialize(&registry_id, &backend);

        let owner = Address::generate(&env);
        let dataset_id = register_dataset(&env, &registry_id, &owner, 100, Some(86_400), None);
        let buyer = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer, 100);
        let lic_id = client.purchase(&dataset_id, &buyer, &token_addr);

        assert_eq!(client.check_access(&lic_id), AccessStatus::Active);
    }

    #[test]
    fn test_expiry_enforcement() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);

        let registry_id = env.register(DatasetRegistry, ());
        let lt_id = env.register(LicenseToken, ());
        let client = LicenseTokenClient::new(&env, &lt_id);
        let backend = Address::generate(&env);
        client.initialize(&registry_id, &backend);

        let owner = Address::generate(&env);
        // 1-second duration
        let dataset_id = register_dataset(&env, &registry_id, &owner, 100, Some(1), None);
        let buyer = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer, 100);
        let lic_id = client.purchase(&dataset_id, &buyer, &token_addr);

        // Active immediately after purchase.
        assert_eq!(client.check_access(&lic_id), AccessStatus::Active);

        // Advance ledger past expiry.
        env.ledger().set_timestamp(1_002);
        assert_eq!(client.check_access(&lic_id), AccessStatus::Expired);
    }

    #[test]
    fn test_query_metering_decrement_and_exhaustion() {
        let env = Env::default();
        env.mock_all_auths();

        let registry_id = env.register(DatasetRegistry, ());
        let lt_id = env.register(LicenseToken, ());
        let client = LicenseTokenClient::new(&env, &lt_id);
        let backend = Address::generate(&env);
        client.initialize(&registry_id, &backend);

        let owner = Address::generate(&env);
        let dataset_id = register_dataset(&env, &registry_id, &owner, 100, None, Some(2));
        let buyer = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer, 100);
        let lic_id = client.purchase(&dataset_id, &buyer, &token_addr);

        assert_eq!(client.check_access(&lic_id), AccessStatus::Active);
        client.consume_query(&lic_id);
        assert_eq!(client.check_access(&lic_id), AccessStatus::Active);
        client.consume_query(&lic_id);
        assert_eq!(client.check_access(&lic_id), AccessStatus::QueryExhausted);
    }

    #[test]
    #[should_panic]
    fn test_consume_query_after_exhaustion_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let registry_id = env.register(DatasetRegistry, ());
        let lt_id = env.register(LicenseToken, ());
        let client = LicenseTokenClient::new(&env, &lt_id);
        let backend = Address::generate(&env);
        client.initialize(&registry_id, &backend);

        let owner = Address::generate(&env);
        let dataset_id = register_dataset(&env, &registry_id, &owner, 100, None, Some(1));
        let buyer = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer, 100);
        let lic_id = client.purchase(&dataset_id, &buyer, &token_addr);

        client.consume_query(&lic_id); // uses last query
        client.consume_query(&lic_id); // should panic
    }

    #[test]
    fn test_revocation_and_access_denied() {
        let env = Env::default();
        env.mock_all_auths();

        let registry_id = env.register(DatasetRegistry, ());
        let lt_id = env.register(LicenseToken, ());
        let client = LicenseTokenClient::new(&env, &lt_id);
        let backend = Address::generate(&env);
        client.initialize(&registry_id, &backend);

        let owner = Address::generate(&env);
        let dataset_id = register_dataset(&env, &registry_id, &owner, 100, Some(86_400), None);
        let buyer = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer, 100);
        let lic_id = client.purchase(&dataset_id, &buyer, &token_addr);

        assert_eq!(client.check_access(&lic_id), AccessStatus::Active);
        client.revoke(&lic_id, &owner);
        assert_eq!(client.check_access(&lic_id), AccessStatus::Revoked);
    }

    #[test]
    #[should_panic]
    fn test_non_owner_cannot_revoke() {
        let env = Env::default();
        env.mock_all_auths();

        let registry_id = env.register(DatasetRegistry, ());
        let lt_id = env.register(LicenseToken, ());
        let client = LicenseTokenClient::new(&env, &lt_id);
        let backend = Address::generate(&env);
        client.initialize(&registry_id, &backend);

        let owner = Address::generate(&env);
        let dataset_id = register_dataset(&env, &registry_id, &owner, 100, Some(86_400), None);
        let buyer = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer, 100);
        let lic_id = client.purchase(&dataset_id, &buyer, &token_addr);

        let attacker = Address::generate(&env);
        client.revoke(&lic_id, &attacker); // must panic
    }

    #[test]
    fn test_hybrid_expiry_and_query_both_limit() {
        // Both limits set: either hitting expiry OR query exhaustion ends access.
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);

        let registry_id = env.register(DatasetRegistry, ());
        let lt_id = env.register(LicenseToken, ());
        let client = LicenseTokenClient::new(&env, &lt_id);
        let backend = Address::generate(&env);
        client.initialize(&registry_id, &backend);

        let owner = Address::generate(&env);
        // 2 queries OR 500s, whichever first
        let dataset_id = register_dataset(&env, &registry_id, &owner, 100, Some(500), Some(2));
        let buyer = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer, 100);
        let lic_id = client.purchase(&dataset_id, &buyer, &token_addr);

        // Use up queries before expiry
        client.consume_query(&lic_id);
        client.consume_query(&lic_id);
        assert_eq!(client.check_access(&lic_id), AccessStatus::QueryExhausted);
    }

    #[test]
    fn test_split_rounding_with_odd_payment() {
        // Verify that rounding remainder goes to owner (contributor 0).
        let env = Env::default();
        env.mock_all_auths();

        let registry_id = env.register(DatasetRegistry, ());
        let lt_id = env.register(LicenseToken, ());
        let client = LicenseTokenClient::new(&env, &lt_id);
        let backend = Address::generate(&env);
        client.initialize(&registry_id, &backend);

        let owner = Address::generate(&env);
        let collab = Address::generate(&env);
        let registry = DatasetRegistryClient::new(&env, &registry_id);
        let mut contributors = Vec::new(&env);
        contributors.push_back(Contributor { address: owner.clone(), basis_points: 5_000 });
        contributors.push_back(Contributor { address: collab.clone(), basis_points: 5_000 });
        // price of 3: 50/50 → each gets 1, remainder 1 goes to owner
        let dataset_id = registry.register_dataset(
            &owner,
            &String::from_str(&env, "ipfs://meta"),
            &BytesN::from_array(&env, &[0u8; 32]),
            &contributors,
            &3i128,
            &AccessTerms { duration_secs: Some(86_400), max_queries: None },
        );
        let buyer = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer, 3);

        client.purchase(&dataset_id, &buyer, &token_addr);

        let token = TokenClient::new(&env, &token_addr);
        // owner gets 1 (floor) + 1 (remainder) = 2, collab gets 1
        assert_eq!(token.balance(&owner), 2);
        assert_eq!(token.balance(&collab), 1);
    }
}
