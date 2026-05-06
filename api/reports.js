export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {

  // ✅ CORS (same as lookups.js)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {

    const { type, cabinet, section } = req.query;

    // ✅ INVENTORY SECTION REPORT
    if (type === "inventory-section") {

      if (!cabinet || !section) {
        return res.status(400).json({
          error: "cabinet and section required"
        });
      }

      const result = await pool.query(
        `
        SELECT
          p.partid,
          p.partnumber,
          p.description,
          l.cabinet,
          l.section,
          l.bin,
          pl.qty
        FROM partlocations pl
        JOIN masterparts p ON p.partid = pl.partid
        JOIN locations l ON l.locationid = pl.locationid
        WHERE l.cabinet = $1
          AND l.section = $2
        ORDER BY l.bin, p.partnumber
        `,
        [cabinet, section]
      );

      return res.status(200).json(result.rows);
    }

    return res.status(400).json({
      error: "Invalid report type"
    });

  } catch (err) {
    console.error("REPORT ERROR:", err);

    return res.status(500).json({
      error: err.message || "Server error"
    });
  }
}
