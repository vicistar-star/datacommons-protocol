/**
 * scripts/seed_testnet_data.ts
 *
 * Seeds realistic example datasets into the DataCommons Protocol marketplace.
 * Datasets span health, agriculture, and climate research categories, with
 * multiple contributors and a mix of time-boxed and query-based access terms —
 * matching the README framing and giving a non-empty marketplace for new
 * contributors cloning the repo.
 *
 * Prerequisites:
 *   - backend/.env is populated (DB, SOROBAN_RPC_URL, contract IDs, etc.)
 *   - DB migrations have been run: cd backend && npm run migrate
 *   - Backend is NOT required to be running — this script writes to the DB
 *     and calls the Soroban RPC directly.
 *
 * Usage:
 *   cd /path/to/datacommons-protocol
 *   npx tsx scripts/seed_testnet_data.ts
 */

import 'dotenv/config';
import path from 'path';
import { config } from 'dotenv';

// Load backend .env
config({ path: path.resolve(__dirname, '../backend/.env') });

import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

interface SeedDataset {
  title: string;
  description: string;
  category: 'health' | 'agri' | 'climate';
  metadata_uri: string;
  consent_hash: string; // 64-char hex (mock SHA-256)
  price_usdc: number;   // in USDC dollars
  duration_days: number | null;
  max_queries: number | null;
  contributors: Array<{ address: string; basis_points: number; label: string }>;
  schema_preview: object;
}

const SEED_DATASETS: SeedDataset[] = [
  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------
  {
    title: 'Malaria Incidence Survey — Uganda 2023',
    description:
      'Longitudinal malaria case counts and environmental covariates from 120 health facilities across 15 districts in Uganda. Collected under IRB approval from Makerere University School of Medicine.',
    category: 'health',
    metadata_uri: 'ipfs://QmHealthUgandaMalaria2023ExampleCIDPlaceholder',
    consent_hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    price_usdc: 120,
    duration_days: 90,
    max_queries: null,
    contributors: [
      { address: 'GDEMOOWNER1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 5000, label: 'PI — Dr. Nakato' },
      { address: 'GDEMOCONTRIB1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 3000, label: 'Field data team' },
      { address: 'GDEMOCONTRIB2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 2000, label: 'Makerere University' },
    ],
    schema_preview: {
      fields: ['district', 'facility_id', 'week', 'cases_confirmed', 'cases_suspected', 'rainfall_mm', 'temp_avg_c'],
      row_count_approx: 75_000,
      format: 'NDJSON',
    },
  },
  {
    title: 'Child Nutrition Biomarkers — Mali 2022',
    description:
      'Anthropometric measurements and hemoglobin biomarkers for 4,200 children under 5 across Mopti and Ségou regions. Community consent obtained through village health worker networks.',
    category: 'health',
    metadata_uri: 'ipfs://QmHealthMaliNutrition2022ExampleCIDPlaceholder',
    consent_hash: 'b2c3d4e5f6a7b2c3d4e5f6a7b2c3d4e5f6a7b2c3d4e5f6a7b2c3d4e5f6a7b2c3',
    price_usdc: 80,
    duration_days: null,
    max_queries: 50,
    contributors: [
      { address: 'GDEMOOWNER2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 6000, label: 'Lead researcher' },
      { address: 'GDEMOCONTRIB3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 2500, label: 'Community health workers' },
      { address: 'GDEMOCONTRIB4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 1500, label: 'UNICEF Mali office' },
    ],
    schema_preview: {
      fields: ['child_id', 'age_months', 'sex', 'muac_cm', 'weight_kg', 'height_cm', 'hb_g_dl', 'region'],
      row_count_approx: 4_200,
      format: 'NDJSON',
    },
  },
  // -------------------------------------------------------------------------
  // Agriculture
  // -------------------------------------------------------------------------
  {
    title: 'Smallholder Maize Yield Trial — Kenya 2021–2023',
    description:
      'Three-season yield trial data from 850 smallholder farms across five agroecological zones in Kenya. Includes soil analysis, input records, and final yield measurements.',
    category: 'agri',
    metadata_uri: 'ipfs://QmAgriKenyaMaize20212023ExampleCIDPlaceholder',
    consent_hash: 'c3d4e5f6a7b8c3d4e5f6a7b8c3d4e5f6a7b8c3d4e5f6a7b8c3d4e5f6a7b8c3d4',
    price_usdc: 200,
    duration_days: 180,
    max_queries: 200,
    contributors: [
      { address: 'GDEMOOWNER3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 4000, label: 'CIMMYT Kenya' },
      { address: 'GDEMOCONTRIB5AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 3000, label: 'Enumerator team' },
      { address: 'GDEMOCONTRIB6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 2000, label: 'Soil lab (Nairobi)' },
      { address: 'GDEMOCONTRIB7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 1000, label: 'Farmer cooperative' },
    ],
    schema_preview: {
      fields: ['farm_id', 'season', 'zone', 'variety', 'fertilizer_kg_ha', 'rainfall_mm', 'yield_kg_ha', 'soil_pH', 'soil_N_ppm'],
      row_count_approx: 7_650,
      format: 'NDJSON',
    },
  },
  {
    title: 'Cassava Disease Surveillance — Nigeria 2023',
    description:
      'Geotagged field observations of cassava mosaic virus and cassava brown streak disease incidence across 300 villages in Benue, Kogi, and Cross River states.',
    category: 'agri',
    metadata_uri: 'ipfs://QmAgriNigeriaCassava2023ExampleCIDPlaceholder',
    consent_hash: 'd4e5f6a7b8c9d4e5f6a7b8c9d4e5f6a7b8c9d4e5f6a7b8c9d4e5f6a7b8c9d4e5',
    price_usdc: 60,
    duration_days: null,
    max_queries: 30,
    contributors: [
      { address: 'GDEMOOWNER4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 7000, label: 'IITA Nigeria' },
      { address: 'GDEMOCONTRIB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 3000, label: 'Extension agent network' },
    ],
    schema_preview: {
      fields: ['village_id', 'lat', 'lon', 'date', 'cmd_severity_0_5', 'cbsd_severity_0_5', 'variety', 'crop_age_weeks'],
      row_count_approx: 9_200,
      format: 'NDJSON',
    },
  },
  // -------------------------------------------------------------------------
  // Climate
  // -------------------------------------------------------------------------
  {
    title: 'Micro-climate Sensor Network — Sahel 2020–2024',
    description:
      'Daily temperature, humidity, wind speed, and solar radiation from 72 low-cost IoT weather stations deployed across the Sahel belt (Burkina Faso, Niger, Chad). Four-year continuous record.',
    category: 'climate',
    metadata_uri: 'ipfs://QmClimeSahelSensors20202024ExampleCIDPlaceholder',
    consent_hash: 'e5f6a7b8c9d0e5f6a7b8c9d0e5f6a7b8c9d0e5f6a7b8c9d0e5f6a7b8c9d0e5f6',
    price_usdc: 350,
    duration_days: 365,
    max_queries: null,
    contributors: [
      { address: 'GDEMOOWNER5AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 5500, label: 'AGRHYMET Regional Centre' },
      { address: 'GDEMOCONTRIB9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 2500, label: 'Station maintenance teams' },
      { address: 'GDEMOCONTRIB10AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 2000, label: 'CILSS' },
    ],
    schema_preview: {
      fields: ['station_id', 'country', 'lat', 'lon', 'date', 'temp_max_c', 'temp_min_c', 'rh_pct', 'wind_ms', 'solar_rad_wm2', 'precip_mm'],
      row_count_approx: 105_120,
      format: 'NDJSON',
    },
  },
  {
    title: 'Coral Bleaching Survey — Western Indian Ocean 2022',
    description:
      'Transect-based coral bleaching severity scores and sea surface temperature from 45 reef sites across Kenya, Tanzania, and the Comoros. Collected during the 2022 ENSO-related bleaching event.',
    category: 'climate',
    metadata_uri: 'ipfs://QmClimeCoralIO2022ExampleCIDPlaceholder',
    consent_hash: 'f6a7b8c9d0e1f6a7b8c9d0e1f6a7b8c9d0e1f6a7b8c9d0e1f6a7b8c9d0e1f6a7',
    price_usdc: 90,
    duration_days: null,
    max_queries: 75,
    contributors: [
      { address: 'GDEMOOWNER6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 4500, label: 'WIOMSA' },
      { address: 'GDEMOCONTRIB11AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 3500, label: 'Marine biologist team' },
      { address: 'GDEMOCONTRIB12AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', basis_points: 2000, label: 'CORDIO East Africa' },
    ],
    schema_preview: {
      fields: ['site_id', 'country', 'lat', 'lon', 'survey_date', 'depth_m', 'bleaching_pct', 'mortality_pct', 'sst_c'],
      row_count_approx: 2_250,
      format: 'NDJSON',
    },
  },
];

// ---------------------------------------------------------------------------
// Insert helpers
// ---------------------------------------------------------------------------

async function seedDataset(ds: SeedDataset): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Skip if title already exists (idempotent re-run).
    const { rows: existing } = await client.query(
      'SELECT id FROM datasets WHERE title = $1',
      [ds.title],
    );
    if (existing.length > 0) {
      console.log(`  skip (already seeded): ${ds.title}`);
      await client.query('ROLLBACK');
      return;
    }

    const priceUnits = BigInt(Math.round(ds.price_usdc * 1e7));
    const durationSecs = ds.duration_days ? BigInt(ds.duration_days * 86_400) : null;

    const { rows: dsRows } = await client.query(
      `INSERT INTO datasets
         (owner_address, title, description, metadata_uri, consent_hash,
          price, duration_secs, max_queries, schema_preview, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        ds.contributors[0].address,
        ds.title,
        ds.description,
        ds.metadata_uri,
        ds.consent_hash,
        priceUnits.toString(),
        durationSecs?.toString() ?? null,
        ds.max_queries,
        JSON.stringify(ds.schema_preview),
        ds.category,
      ],
    );
    const datasetId = dsRows[0].id as number;

    for (const c of ds.contributors) {
      await client.query(
        `INSERT INTO contributors (dataset_id, address, basis_points, label)
         VALUES ($1,$2,$3,$4)`,
        [datasetId, c.address, c.basis_points, c.label],
      );
    }

    await client.query('COMMIT');
    console.log(`  seeded: ${ds.title} (db id=${datasetId})`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  ERROR seeding "${ds.title}":`, err);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('DataCommons Protocol — seed script');
  console.log(`Database: ${process.env.DATABASE_URL?.replace(/:\/\/.*@/, '://<credentials>@')}`);
  console.log(`Seeding ${SEED_DATASETS.length} example datasets...\n`);

  for (const ds of SEED_DATASETS) {
    await seedDataset(ds);
  }

  console.log('\nSeed complete.');
  console.log('Note: contract_dataset_id is NULL for seeded rows until the owner runs');
  console.log('the on-chain register_dataset transaction and calls PATCH /datasets/:id/confirm.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
