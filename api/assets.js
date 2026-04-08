export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  // ✅ CORS HEADERS (REQUIRED)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const client = await pool.connect();

    const result = await client.query(`
      SELECT
        assetid,
        assettag,
        description
      FROM assets
      ORDER BY assettag
    `);

    client.release();

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Failed to fetch assets:", err);
    res.status(500).json({ error: "Failed to fetch assets" });
  }
}
