import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('connect', (client) => {
  console.log('Postgres client connected');
});

pool.on('error', (err) => {
  console.error('Postgres error', err);
});

export default pool;