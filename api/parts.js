export const runtime = "nodejs";

import { Pool } from "pg";

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    });
  }
  return pool;
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT * FROM masterparts LIMIT 100"
    );
    res.status(200).json(rows);
  } catch (err) {
    console.error("PARTS ERROR:", err);
    res.status(500).json({
      error: err.message
    });
  }
}
