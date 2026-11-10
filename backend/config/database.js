import pg from 'pg';
import 'dotenv/config';

const { Pool, types } = pg;

// Keep DATE columns as YYYY-MM-DD strings (avoid timezone shift)
types.setTypeParser(1082, (value) => value);

export const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: Number(process.env.POSTGRES_PORT || 5432),
        user: process.env.POSTGRES_USER || 'travel',
        password: process.env.POSTGRES_PASSWORD || 'travel',
        database: process.env.POSTGRES_DB || 'travel',
      },
);

export async function query(text, params) {
  return pool.query(text, params);
}

export async function pingDb() {
  await pool.query('SELECT 1');
}
