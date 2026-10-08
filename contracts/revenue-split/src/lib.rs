#![no_std]

// RevenueSplit is a pure-computation library crate.  It does not export a
// Soroban contract — it is used as a dependency inside LicenseToken.
// All types here are plain Rust (no soroban_sdk::Vec, no Env) so the
// computation can be reasoned about and tested independently.

extern crate alloc;
use alloc::vec::Vec;

/// A single computed payout: index into the contributor slice + amount.
///
/// We return indices (not addresses) so the library stays address-type-agnostic
/// and can be tested without a Soroban environment.
#[derive(Clone, Debug, PartialEq)]
pub struct Payout {
    /// Index of the contributor in the original slice (0 = dataset owner).
    pub contributor_index: usize,
    /// Amount to transfer (in the payment token's smallest unit).
    pub amount: i128,
}

/// Compute per-contributor payout amounts from a total `payment` and a
/// `basis_points` slice.
///
/// Rules:
/// - Each contributor receives `floor(payment * basis_points[i] / 10_000)`.
/// - Any rounding remainder goes to contributor at index 0 (the dataset owner),
///   which makes rounding deterministic and auditable.
/// - The returned amounts sum to exactly `payment`.
///
/// # Panics
/// - If `basis_points` is empty.
/// - If `payment` is negative.
pub fn compute_splits(payment: i128, basis_points: &[u32]) -> Vec<Payout> {
    assert!(payment >= 0, "payment must be non-negative");
    assert!(!basis_points.is_empty(), "contributors must not be empty");

    let mut payouts = Vec::with_capacity(basis_points.len());
    let mut distributed: i128 = 0;

    for (i, &bp) in basis_points.iter().enumerate() {
        let amount = (payment * bp as i128) / 10_000;
        payouts.push(Payout {
            contributor_index: i,
            amount,
        });
        distributed += amount;
    }

    // Remainder to contributor 0 (dataset owner) — deterministic.
    let remainder = payment - distributed;
    if remainder > 0 {
        payouts[0].amount += remainder;
    }

    payouts
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_even_split() {
        let payouts = compute_splits(1_000_000, &[5_000, 5_000]);
        assert_eq!(payouts.len(), 2);
        assert_eq!(payouts[0].amount, 500_000);
        assert_eq!(payouts[1].amount, 500_000);
    }

    #[test]
    fn test_uneven_split_rounding_remainder_to_owner() {
        // 70/20/10 split on payment=3: floor(3*7000/10000)=2, others=0 → rem=1 to owner
        let payouts = compute_splits(3, &[7_000, 2_000, 1_000]);
        assert_eq!(payouts[0].amount, 3); // 2 + 1 remainder
        assert_eq!(payouts[1].amount, 0);
        assert_eq!(payouts[2].amount, 0);

        let total: i128 = payouts.iter().map(|p| p.amount).sum();
        assert_eq!(total, 3);
    }

    #[test]
    fn test_sum_equals_payment_arbitrary() {
        let payment = 1_234_567i128;
        let payouts = compute_splits(payment, &[6_000, 2_500, 1_500]);
        let total: i128 = payouts.iter().map(|p| p.amount).sum();
        assert_eq!(total, payment, "payouts must sum to the full payment");
    }

    #[test]
    fn test_single_contributor() {
        let payouts = compute_splits(99_999, &[10_000]);
        assert_eq!(payouts.len(), 1);
        assert_eq!(payouts[0].amount, 99_999);
        assert_eq!(payouts[0].contributor_index, 0);
    }

    #[test]
    fn test_zero_payment() {
        let payouts = compute_splits(0, &[5_000, 5_000]);
        assert_eq!(payouts[0].amount, 0);
        assert_eq!(payouts[1].amount, 0);
    }

    #[test]
    fn test_large_payment_many_contributors() {
        // 5 contributors at 20% each, large payment
        let payment = 1_000_000_000i128;
        let bps = [2_000u32; 5];
        let payouts = compute_splits(payment, &bps);
        let total: i128 = payouts.iter().map(|p| p.amount).sum();
        assert_eq!(total, payment);
        for p in &payouts {
            assert_eq!(p.amount, 200_000_000);
        }
    }

    #[test]
    fn test_indices_match_input_order() {
        let payouts = compute_splits(100, &[3_000, 5_000, 2_000]);
        assert_eq!(payouts[0].contributor_index, 0);
        assert_eq!(payouts[1].contributor_index, 1);
        assert_eq!(payouts[2].contributor_index, 2);
    }

    #[test]
    fn test_rounding_adds_only_to_index_zero() {
        // Payment of 1 with 3 equal-share contributors → all floor to 0, rem=1 to owner
        let payouts = compute_splits(1, &[3_334, 3_333, 3_333]);
        assert_eq!(payouts[0].amount, 1);
        assert_eq!(payouts[1].amount, 0);
        assert_eq!(payouts[2].amount, 0);
    }
}
