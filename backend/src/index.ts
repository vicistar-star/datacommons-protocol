import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import datasetsRouter, { provenanceRouter } from './api/datasets';
import licensesRouter from './api/licenses';
import queryRouter from './api/query';

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// API routes (matching README API Reference table)
app.use('/datasets', datasetsRouter);
app.use('/licenses', licensesRouter);
app.use('/query', queryRouter);
app.use('/provenance', provenanceRouter);

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Backend API running at http://localhost:${port}`);
});

export { app };
