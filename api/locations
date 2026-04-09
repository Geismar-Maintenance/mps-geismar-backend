export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  // ✅ CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        locationid,
        cabinet,
        section,
        bin,
        description,
        isreceiving,
        isactive
      FROM locations
      WHERE isactive = true
      ORDER BY cabinet, section, bin
      `
    );

    return res.status(200).json(result.rows);

  } catch (err) {
    console.error("ERROR fetching locations:", err);
    return res.status(500).json({ error: "Failed to fetch locations" });
  }
}
