import express, { Request, Response } from 'express';

const app = express();
const port = process.env.PORT || 4000;

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Backend API running at http://localhost:${port}`);
});

export { app };