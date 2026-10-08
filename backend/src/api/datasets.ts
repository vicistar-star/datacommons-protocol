/**
 * GET /datasets        — list / search datasets (metadata + price + access terms)
 * GET /datasets/:id    — dataset detail (schema, sample, contributors, consent hash)
 * POST /datasets       — register dataset: write off-chain metadata AND call
 *                        on-chain register_dataset in the same flow
 * GET /provenance/:datasetId — full on-chain event history
 */

import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { DatasetRow, ContributorRow } from '../db/models';
import {
  buildRegisterDatasetTx,
  getDataset,
  getProvenanceEvents,
} from '../chain/client';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function datasetView(row: DatasetRow, contributors: ContributorRow[]) {
  return {
    id: row.id,
    contract_dataset_id: row.contract_dataset_id,
    owner_address: row.owner_address,
    title: row.title,
    description: row.description,
    metadata_uri: row.metadata_uri,
    consent_hash: row.consent_hash,
    price: row.price,
    duration_secs: row.duration_secs,
    max_queries: row.max_queries,
    schema_preview: row.schema_preview,
    category: row.category,
    created_at: row.created_at,
    contributors: contributors.map((c) => ({
      address: c.address,
      basis_points: c.basis_points,
      label: c.label,
    })),
  };
}

// ---------------------------------------------------------------------------
// GET /datasets
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const { q, category, page = '1', limit = '20' } = req.query as Record<string, string>;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(d.title ILIKE $${params.length} OR d.description ILIKE $${params.length})`);
  }
  if (category) {
    params.push(category);
    conditions.push(`d.category = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(parseInt(limit, 10), offset);

  const { rows } = await pool.query<DatasetRow>(
    `SELECT * FROM datasets d ${where}
     ORDER BY d.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  res.json({ datasets: rows, page: parseInt(page, 10), limit: parseInt(limit, 10) });
});

// ---------------------------------------------------------------------------
// GET /datasets/:id
// ---------------------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { rows: datasetRows } = await pool.query<DatasetRow>(
    'SELECT * FROM datasets WHERE id = $1',
    [id],
  );
  if (!datasetRows.length) {
    res.status(404).json({ error: 'Dataset not found' });
    return;
  }
  const dataset = datasetRows[0];

  const { rows: contribRows } = await pool.query<ContributorRow>(
    'SELECT * FROM contributors WHERE dataset_id = $1 ORDER BY id',
    [dataset.id],
  );

  res.json(datasetView(dataset, contribRows));
});

// ---------------------------------------------------------------------------
// POST /datasets
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  const {
    owner_address,
    title,
    description = '',
    metadata_uri,
    consent_hash,
    price,
    duration_secs = null,
    max_queries = null,
    contributors,
    schema_preview = null,
    category = null,
  } = req.body as {
    owner_address: string;
    title: string;
    description?: string;
    metadata_uri: string;
    consent_hash: string;
    price: string;
    duration_secs?: string | null;
    max_queries?: number | null;
    contributors: Array<{ address: string; basis_points: number; label?: string }>;
    schema_preview?: unknown;
    category?: string | null;
  };

  // Basic validation.
  if (!owner_address || !title || !metadata_uri || !consent_hash || !price || !contributors?.length) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  const bpSum = contributors.reduce((s, c) => s + c.basis_points, 0);
  if (bpSum !== 10_000) {
    res.status(400).json({ error: 'Contributor basis_points must sum to 10000' });
    return;
  }
  if (!duration_secs && !max_queries) {
    res.status(400).json({ error: 'At least one of duration_secs or max_queries must be set' });
    return;
  }

  // Build the unsigned Soroban transaction for the owner to sign.
  const unsignedXdr = await buildRegisterDatasetTx({
    ownerAddress: owner_address,
    metadataUri: metadata_uri,
    consentHash: consent_hash,
    contributors,
    price: BigInt(price),
    accessTerms: {
      duration_secs: duration_secs ? BigInt(duration_secs) : null,
      max_queries: max_queries ?? null,
    },
  });

  // Persist off-chain metadata immediately.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: dsRows } = await client.query<DatasetRow>(
      `INSERT INTO datasets
         (owner_address, title, description, metadata_uri, consent_hash,
          price, duration_secs, max_queries, schema_preview, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        owner_address, title, description, metadata_uri, consent_hash,
        price, duration_secs, max_queries,
        schema_preview ? JSON.stringify(schema_preview) : null,
        category,
      ],
    );
    const dataset = dsRows[0];

    for (const c of contributors) {
      await client.query(
        `INSERT INTO contributors (dataset_id, address, basis_points, label)
         VALUES ($1,$2,$3,$4)`,
        [dataset.id, c.address, c.basis_points, c.label ?? null],
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      dataset_id: dataset.id,
      // Return unsigned XDR for owner's wallet to sign and submit on-chain.
      unsigned_xdr: unsignedXdr,
      message: 'Off-chain metadata saved. Sign and submit unsigned_xdr to complete on-chain registration.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * PATCH /datasets/:id/confirm — called after the owner's wallet signs and
 * submits the register_dataset transaction, to store the on-chain dataset id.
 */
router.patch('/:id/confirm', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { contract_dataset_id } = req.body as { contract_dataset_id: string };

  if (!contract_dataset_id) {
    res.status(400).json({ error: 'contract_dataset_id is required' });
    return;
  }

  await pool.query(
    'UPDATE datasets SET contract_dataset_id = $1 WHERE id = $2',
    [contract_dataset_id, id],
  );

  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// GET /provenance/:datasetId
// ---------------------------------------------------------------------------
export const provenanceRouter = Router();

provenanceRouter.get('/:datasetId', async (req: Request, res: Response) => {
  const { datasetId } = req.params;
  const events = await getProvenanceEvents(BigInt(datasetId));
  // Stringify BigInt values so JSON.stringify doesn't throw.
  const serializable = JSON.parse(
    JSON.stringify(events, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );
  res.json({ dataset_id: datasetId, events: serializable });
});

export default router;
