#!/usr/bin/env bash
# scripts/deploy_contracts.sh
#
# Deploys all DataCommons Protocol contracts to the configured Stellar network.
# Run from the repository root.
#
# Prerequisites:
#   - stellar-cli (or soroban-cli) installed and on PATH
#   - A funded Stellar account identity configured (e.g. via `stellar keys generate`)
#   - STELLAR_NETWORK env var set to "testnet" (default) or "mainnet"
#   - DEPLOYER_IDENTITY env var set to the name of your stellar-cli identity
#
# After a successful deploy the contract IDs are written to:
#   docs/testnet-deployment.md  (for testnet)
#   docs/mainnet-deployment.md  (for mainnet)
#
# Usage:
#   DEPLOYER_IDENTITY=alice STELLAR_NETWORK=testnet bash scripts/deploy_contracts.sh

set -euo pipefail

NETWORK="${STELLAR_NETWORK:-testnet}"
IDENTITY="${DEPLOYER_IDENTITY:?DEPLOYER_IDENTITY must be set}"
CONTRACTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/contracts"
DOCS_DIR="$(cd "$(dirname "$0")/.." && pwd)/docs"

if [[ "$NETWORK" == "mainnet" ]]; then
  NETWORK_FLAG="--network mainnet"
  DEPLOY_DOC="$DOCS_DIR/mainnet-deployment.md"
else
  NETWORK_FLAG="--network testnet"
  DEPLOY_DOC="$DOCS_DIR/testnet-deployment.md"
fi

echo "==> Building contracts (target: wasm32-unknown-unknown)..."
cd "$CONTRACTS_DIR"
stellar contract build

echo ""
echo "==> Deploying dataset-registry..."
REGISTRY_ID=$(stellar contract deploy \
  --wasm "target/wasm32-unknown-unknown/release/dataset_registry.wasm" \
  --source "$IDENTITY" \
  $NETWORK_FLAG)
echo "    DatasetRegistry: $REGISTRY_ID"

echo ""
echo "==> Deploying license-token..."
LICENSE_ID=$(stellar contract deploy \
  --wasm "target/wasm32-unknown-unknown/release/license_token.wasm" \
  --source "$IDENTITY" \
  $NETWORK_FLAG)
echo "    LicenseToken: $LICENSE_ID"

echo ""
echo "==> Initialising LicenseToken with registry address..."
# BACKEND_ADDRESS is the account that will call consume_query.
BACKEND_ADDRESS="${BACKEND_ADDRESS:-}"
if [[ -z "$BACKEND_ADDRESS" ]]; then
  echo "    WARNING: BACKEND_ADDRESS not set — skipping initialize call."
  echo "    Run manually: stellar contract invoke --id $LICENSE_ID --source $IDENTITY $NETWORK_FLAG -- initialize --registry_addr $REGISTRY_ID --backend_addr <BACKEND_ADDRESS>"
else
  stellar contract invoke \
    --id "$LICENSE_ID" \
    --source "$IDENTITY" \
    $NETWORK_FLAG \
    -- initialize \
    --registry_addr "$REGISTRY_ID" \
    --backend_addr "$BACKEND_ADDRESS"
  echo "    LicenseToken initialized."
fi

echo ""
DEPLOY_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "$DEPLOY_DOC" <<EOF
# Testnet Deployment — DataCommons Protocol

Deployed: $DEPLOY_DATE  
Network: $NETWORK  
Deployer identity: $IDENTITY

## Contract IDs

| Contract | ID |
|---|---|
| \`DatasetRegistry\` | \`$REGISTRY_ID\` |
| \`LicenseToken\`    | \`$LICENSE_ID\`  |

## Environment variable snippets

Paste these into \`backend/.env\` and \`frontend/.env\`:

\`\`\`
DATASET_REGISTRY_CONTRACT_ID=$REGISTRY_ID
LICENSE_TOKEN_CONTRACT_ID=$LICENSE_ID
\`\`\`

## Notes

- \`RevenueSplit\` is a library crate, not a deployed contract.
- Run \`scripts/seed_testnet_data.ts\` after deployment to populate example datasets.
- Re-run this script to redeploy (new contract IDs will be generated; update .env files accordingly).
EOF

echo "==> Deployment complete. Contract IDs written to $DEPLOY_DOC"
echo ""
echo "Next steps:"
echo "  1. Copy contract IDs from $DEPLOY_DOC into backend/.env and frontend/.env."
echo "  2. Set STABLECOIN_CONTRACT_ID (USDC) in backend/.env and frontend/.env."
echo "  3. Run: cd backend && npm run migrate"
echo "  4. Run: npx tsx scripts/seed_testnet_data.ts"
