/**
 * POST /query/:licenseId — metered query proxy
 *
 * Per README "Smart Contract Design":
 *   1. Calls check_access on-chain — license must be Active.
 *   2. Calls consume_query on-chain (decrements counter, emits QueryConsumed).
 *   3. Executes the requested query server-side against the dataset.
 *   4. Returns only the query result — never the raw file.
 *
 * Per README "Security Considerations":
 *   - Expiry is re-checked on every access attempt (not only at first download).
 *   - For time-boxed licenses, a decryption key is only released after on-chain
 *     license verification; for query-based licenses the raw file is never
 *     returned.
 */

import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { LicenseRow, DatasetRow } from '../db/models';
import { checkAccess, consumeQuery } from '../chain/client';
import { downloadAndDecrypt } from '../storage/index';

const router = Router();

// ---------------------------------------------------------------------------
// Query executor
// ---------------------------------------------------------------------------

/**
 * Supported query types.
 * MVP supports: count, sample (N random rows), filter (equality match on field).
 *
 * The raw dataset file is expected to be newline-delimited JSON (NDJSON).
 * If the file is not NDJSON, count returns the byte length and other queries
 * return an informational response.
 */
type QueryRequest =
  | { type: 'count' }
  | { type: 'sample'; n: number }
  | { type: 'filter'; field: string; value: string | number };

function executeQuery(plaintext: Buffer, query: QueryRequest): unknown {
  // Attempt to parse as NDJSON.
  const text = plaintext.toString('utf8');
  const lines = text.split('\n').filter((l) => l.trim());

  let records: unknown[] = [];
  let parseOk = true;
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      parseOk = false;
      break;
    }
  }

  if (!parseOk) {
    // Fall back to raw stats — never return the file content.
    return {
      type: 'stats',
      byte_count: plaintext.length,
      note: 'Dataset is not NDJSON; only byte-level stats available.',
    };
  }

  switch (query.type) {
    case 'count':
      return { count: records.length };

    case 'sample': {
      const n = Math.min(query.n, records.length);
      const shuffled = [...records].sort(() => Math.random() - 0.5);
      return { sample: shuffled.slice(0, n), total: records.length };
    }

    case 'filter': {
      const matched = records.filter((r) => {
        const obj = r as Record<string, unknown>;
        return String(obj[query.field]) === String(query.value);
      });
      return { results: matched, matched: matched.length, total: records.length };
    }
  }
}

// ---------------------------------------------------------------------------
// POST /query/:licenseId
// ---------------------------------------------------------------------------
router.post('/:licenseId', async (req: Request, res: Response) => {
  const licenseId = BigInt(req.params.licenseId);
  const query = req.body as QueryRequest;

  if (!query?.type) {
    res.status(400).json({ error: 'query.type is required (count | sample | filter)' });
    return;
  }

  // ------------------------------------------------------------------
  // Step 1: Re-check access on-chain (every request — not just first).
  // ------------------------------------------------------------------
  const status = await checkAccess(licenseId);
  if (status !== 'Active') {
    res.status(403).json({ error: `Access denied: license status is ${status}` });
    return;
  }

  // ------------------------------------------------------------------
  // Step 2: Consume one query credit on-chain.
  // ------------------------------------------------------------------
  await consumeQuery(licenseId);

  // ------------------------------------------------------------------
  // Step 3: Load the dataset and execute the query server-side.
  //         The raw decrypted file is never sent to the buyer.
  // ------------------------------------------------------------------
  const { rows: licenseRows } = await pool.query<LicenseRow>(
    'SELECT * FROM licenses WHERE contract_license_id = $1',
    [licenseId.toString()],
  );

  if (!licenseRows.length) {
    res.status(404).json({ error: 'License not found in local cache' });
    return;
  }

  const license = licenseRows[0];

  const { rows: datasetRows } = await pool.query<DatasetRow>(
    'SELECT * FROM datasets WHERE id = $1',
    [license.dataset_id],
  );

  if (!datasetRows.length) {
    res.status(404).json({ error: 'Dataset not found' });
    return;
  }

  const dataset = datasetRows[0];
  const contractDatasetId = BigInt(dataset.contract_dataset_id ?? '0');

  // Download and decrypt the file — key released only after license verified above.
  const plaintext = await downloadAndDecrypt(dataset.metadata_uri, contractDatasetId);

  // Execute the query and return only the result.
  const result = executeQuery(plaintext, query);

  res.json({
    license_id: licenseId.toString(),
    dataset_id: dataset.contract_dataset_id,
    query,
    result,
  });
});

export default router;
