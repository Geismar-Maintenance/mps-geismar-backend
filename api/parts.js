export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const client = await pool.connect();

    // 1️⃣ Get parts with total quantity
    const partsResult = await client.query(`
      SELECT
        p.partid,
        p.partnumber,
        p.manufacturer,
        p.model,
        p.description,
        p.cost,
        p.reorderlevel,
        COALESCE(SUM(l.qty), 0) AS total_qty
      FROM masterparts p
      LEFT JOIN partlocations l ON l.partid = p.partid
      GROUP BY p.partid
      ORDER BY p.partnumber
    `);

    // 2️⃣ Get all locations with qty > 0
    const locationsResult = await client.query(`
      SELECT
        locationid,
        partid,
        cabinet,
        section,
        bin,
        qty
      FROM partlocations
      WHERE qty > 0
      ORDER BY cabinet, section, bin
    `);

    client.release();

    // 3️⃣ Attach locations to each part
    const parts = partsResult.rows.map(part => ({
      ...part,
      locations: locationsResult.rows.filter(
        loc => loc.partid === part.partid
      )
    }));

    res.status(200).json(parts);
  } catch (err) {
    console.error("Failed to fetch parts:", err);
    res.status(500).json({ error: "Failed to fetch parts" });
  }
}
