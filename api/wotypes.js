export const runtime = "nodejs";

import pool from "../lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const result = await pool.query(`
    SELECT id, name
    FROM wotypes
    ORDER BY name
  `);

  res.status(200).json(result.rows);
}
