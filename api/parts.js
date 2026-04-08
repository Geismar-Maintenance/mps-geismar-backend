export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  // ✅ CORS HEADERS — MUST BE FIRST, NO EXCEPTIONS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ✅ Allow GET only
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const search = req.query.search?.trim() || "";

  // ✅ Guard short search (SAFE, no SQL yet)
  if (search.length < 2) {
    return res.status(200).json([]);
  }

  let client;

  try {
    client = await pool.connect();

    const partsResult = await client.query(
      `
      SELECT
        p.partid,
        p.partnumber,
        p.manufacturer,
        p.model,
        p.description,
        p.cost,
        p.reorderlevel,
        COALESCE(SUM(l.qty), 0)::INTEGER AS total_qty
      FROM masterparts p
      LEFT JOIN partlocations l ON l.partid = p.partid
      WHERE
        COALESCE(p.partnumber, '') ILIKE $1 OR
        COALESCE(p.model, '') ILIKE $1 OR
        COALESCE(p.description, '') ILIKE $1
      GROUP BY p.partid
      ORDER BY p.partnumber
      LIMIT 100
      `,
      [`%${search}%`]
    );

    const locationsResult = await client.query(
      `
      SELECT
        locationid,
        partid,
        cabinet,
        section,
        bin,
        qty
      FROM partlocations
      WHERE qty > 0
      `
    );

    const parts = partsResult.rows.map(p => ({
      ...p,
      locations: locationsResult.rows.filter(l => l.partid === p.partid)
    }));

    return res.status(200).json(parts);

  } catch (err) {
    console.error("ERROR in /api/parts:", err);

    // ✅ Headers already set, so browser will NOT show CORS error
    return res.status(500).json({
      error: "Failed to fetch parts"
    });

  } finally {
    if (client) client.release();
  }
}
``
