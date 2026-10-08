/**
 * License routes — implemented in Day 5 (purchase flow + licenses/mine).
 * Stub: returns 501 Not Implemented until then.
 */
import { Router, Request, Response } from 'express';
const router = Router();

router.post('/purchase', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

router.get('/mine', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

export default router;
