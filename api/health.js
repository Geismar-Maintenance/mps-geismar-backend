/** Force Node runtime (required for pg) */
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
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({
      error: err.message,
      code: err.code
    });
  }
}
