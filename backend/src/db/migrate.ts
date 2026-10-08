import pool from './pool';

/**
 * Create all tables needed by DataCommons Protocol.
 *
 * Schema design:
 *   datasets      – off-chain metadata paired with an on-chain dataset_id.
 *   contributors  – denormalized per-dataset contributor cache for fast display.
 *   licenses      – cached view of on-chain license state for fast queries.
 *
 * Run with: npm run migrate
 */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // -----------------------------------------------------------------------
    // datasets
    // -----------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS datasets (
        id               SERIAL PRIMARY KEY,
        -- on-chain dataset id assigned by DatasetRegistry.register_dataset
        contract_dataset_id  BIGINT UNIQUE,
        owner_address    TEXT    NOT NULL,
        title            TEXT    NOT NULL,
        description      TEXT    NOT NULL DEFAULT '',
        -- URI pointing to encrypted file in IPFS / Arweave
        metadata_uri     TEXT    NOT NULL,
        -- SHA-256 hex of the signed consent / IRB document (stored on-chain)
        consent_hash     TEXT    NOT NULL,
        -- price in stablecoin smallest unit (e.g. USDC micro-units)
        price            BIGINT  NOT NULL,
        -- hybrid access-control terms (either or both may be set)
        duration_secs    BIGINT,
        max_queries      INT,
        -- off-chain schema / sample metadata (JSON blob)
        schema_preview   JSONB,
        -- categorisation tag (health | agri | climate | …)
        category         TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // -----------------------------------------------------------------------
    // contributors
    // -----------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS contributors (
        id               SERIAL PRIMARY KEY,
        dataset_id       INT     NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
        address          TEXT    NOT NULL,
        -- basis points (0-10 000); all rows for a dataset must sum to 10 000
        basis_points     INT     NOT NULL,
        -- human-readable label (optional, e.g. "PI", "field team")
        label            TEXT,
        UNIQUE(dataset_id, address)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contributors_dataset
        ON contributors(dataset_id)
    `);

    // -----------------------------------------------------------------------
    // licenses  (cached view of on-chain license state)
    // -----------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id               SERIAL PRIMARY KEY,
        -- on-chain license id from LicenseToken.purchase
        contract_license_id  BIGINT UNIQUE NOT NULL,
        dataset_id           INT    NOT NULL REFERENCES datasets(id),
        buyer_address        TEXT   NOT NULL,
        -- mirrors LicenseRecord fields from the contract
        expires_at           TIMESTAMPTZ,
        queries_remaining    INT,
        revoked              BOOLEAN NOT NULL DEFAULT FALSE,
        -- when we last synced from chain
        last_synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_licenses_buyer
        ON licenses(buyer_address)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_licenses_dataset
        ON licenses(dataset_id)
    `);

    await client.query('COMMIT');
    console.log('Migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Allow direct execution: tsx src/db/migrate.ts
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
