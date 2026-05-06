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
  const { type } = req.query;
  const db = getPool();

  try {

    // =========================================
    // INVENTORY BY CABINET / SECTION
    // =========================================
    if (type === "inventory-section") {

      const { cabinet, section } = req.query;

      if (!cabinet || !section) {
        return res.status(400).json({
          error: "cabinet and section required"
        });
      }

      const result = await db.query(
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

      return res.status(200).json(result.rows);
    }

    // =========================================
    // UNKNOWN REPORT TYPE
    // =========================================
    return res.status(400).json({
      error: "Invalid report type"
    });

  } catch (err) {
    console.error("Report error:", err);
    return res.status(500).json({
      error: "Server error"
    });
  }
}
