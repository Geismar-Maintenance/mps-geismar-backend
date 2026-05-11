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

  try {

    const { type, cabinet, section } = req.query;

    // ===============================
    // ✅ INVENTORY SECTION REPORT
    // ===============================
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
          AND l.section LIKE $2
        ORDER BY
          length(l.bin),
          l.bin,
          p.partnumber;
        `,
        [cabinet, section]
      );

      return res.status(200).json(result.rows);
    }

    // ===============================
    // ✅ RUNTIME VALIDATION (NEW)
    // ===============================
    if (type === "missing-runtime") {

      const result = await pool.query(`
        WITH current_week AS (
          SELECT *
          FROM calendar_weeks
          WHERE CURRENT_DATE BETWEEN week_start AND week_end
        ),

        previous_week AS (
          SELECT *
          FROM calendar_weeks
          WHERE (
            (SELECT week_number FROM current_week) > 1
            AND week_number = (SELECT week_number FROM current_week) - 1
            AND year = (SELECT year FROM current_week)
          )
          OR (
            (SELECT week_number FROM current_week) = 1
            AND year = (SELECT year FROM current_week) - 1
            AND week_number = (
              SELECT MAX(week_number)
              FROM calendar_weeks
              WHERE year = (SELECT year FROM current_week) - 1
            )
          )
        )

        SELECT 
          a.assetid,
          a.assetname,
          pw.week_number,
          pw.year
        FROM assets a
        CROSS JOIN previous_week pw
        LEFT JOIN asset_runtime_logs arl
          ON arl.asset_id = a.assetid
          AND arl.runtime_date BETWEEN pw.week_start AND pw.week_end
        WHERE a.isactive = true
        GROUP BY a.assetid, a.assetname, pw.week_number, pw.year
        HAVING COALESCE(SUM(arl.runtime_hours), 0) = 0;
      `);

      return res.status(200).json({
        missingAssets: result.rows,
        hasMissing: result.rows.length > 0,
        week: result.rows[0]?.week_number || null,
        year: result.rows[0]?.year || null
      });
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
