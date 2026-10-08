/**
 * Query proxy route — implemented in Day 5 (metered query proxy).
 * Stub: returns 501 Not Implemented until then.
 */
import { Router, Request, Response } from 'express';
const router = Router();

router.post('/:licenseId', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

export default router;
