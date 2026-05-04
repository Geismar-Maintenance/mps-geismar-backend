export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {

  // CORS
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

    const partid = Number(req.query.partid);

    if (!partid) {
      return res.status(400).json({ error: "partid is required" });
    }

    const result = await pool.query(`
      SELECT
        pl.partid,
        pl.locationid,
        l.cabinet,
        l.section,
        l.bin,
        l.description AS location_description,
        pl.qty
      FROM partlocations pl
      JOIN locations l
        ON l.locationid = pl.locationid
      WHERE pl.partid = $1
        AND pl.qty > 0
      ORDER BY l.cabinet, l.section, l.bin
    `, [partid]);

    return res.status(200).json(result.rows);

  } catch (err) {
    console.error("PARTLOCATIONS ERROR:", err);
    return res.status(500).json({ error: "Failed to fetch part locations" });
  }
}
