export const runtime = "nodejs";

import pool from "../lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const result = await pool.query(`
    SELECT id, name
    FROM wopriorities
    ORDER BY id
  `);

  res.status(200).json(result.rows);
}
