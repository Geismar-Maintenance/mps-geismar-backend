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

  const summary = req.query.summary;
  const search = req.query.search?.trim() || "";

  /* ======================================================
     ✅ DASHBOARD INVENTORY SUMMARY MODE
     ====================================================== */
  if (summary === "inventory") {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*) FILTER (
            WHERE total_qty = 0
          ) AS out_stock,
          COUNT(*) FILTER (
            WHERE reorderlevel > 0 AND total_qty <= reorderlevel
          ) AS low_stock
        FROM (
          SELECT
            p.partid,
            COALESCE(SUM(pl.qty), 0) AS total_qty,
            p.reorderlevel
          FROM masterparts p
          LEFT JOIN partlocations pl ON p.partid = pl.partid
          GROUP BY p.partid
        ) t;
      `);

      return res.status(200).json(result.rows[0]);

    } catch (err) {
      console.error("ERROR in /api/parts summary:", err);
      return res.status(500).json({ error: "Inventory summary failed" });
    }
  }

  /* ======================================================
     ✅ STANDARD PART SEARCH MODE
     ====================================================== */

  if (search.length < 2) {
    return res.status(200).json([]);
  }

  let client;

  try {
    client = await pool.connect();

    // ✅ Part master + total quantity
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
        COALESCE(SUM(pl.qty), 0)::INTEGER AS total_qty
      FROM masterparts p
      LEFT JOIN partlocations pl ON pl.partid = p.partid
      WHERE
        p.partnumber ILIKE $1 OR
        p.model ILIKE $1 OR
        p.description ILIKE $1
      GROUP BY p.partid
      ORDER BY p.partnumber
      LIMIT 100
      `,
      [`%${search}%`]
    );

    // ✅ Inventory locations
    const locationsResult = await client.query(
      `
      SELECT
        pl.partid,
        pl.locationid,
        l.cabinet,
        l.section,
        l.bin,
        pl.qty
      FROM partlocations pl
      JOIN locations l ON l.locationid = pl.locationid
      WHERE pl.qty > 0
      `
    );

    const parts = partsResult.rows.map(p => ({
      ...p,
      locations: locationsResult.rows.filter(
        l => l.partid === p.partid
      )
    }));

    return res.status(200).json(parts);

  } catch (err) {
    console.error("ERROR in /api/parts:", err);
    return res.status(500).json({ error: "Failed to fetch parts" });

  } finally {
    if (client) client.release();
  }
}
