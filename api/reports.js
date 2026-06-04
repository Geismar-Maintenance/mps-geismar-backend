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
// ✅ PARTS USAGE (DATE RANGE)
// ===============================
if (type === "parts-usage") {

  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({
      error: "startDate and endDate required"
    });
  }

  const result = await pool.query(`
    SELECT
  p.partid,
  p.partnumber,
  p.description,
  SUM(t.qty) AS total_used,
  COUNT(*) AS transaction_count
FROM transactions t
JOIN masterparts p ON p.partid = t.partid
WHERE
  t.transactiontypeid = 1
  AND t.transactiondate >= $1
  AND t.transactiondate < $2
GROUP BY
  p.partid,
  p.partnumber,
  p.description
ORDER BY total_used DESC;
  `, [startDate, endDate]);

  return res.status(200).json(result.rows);
}

    
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
      SELECT week_id, week_number, year
      FROM calendar_weeks
      WHERE CURRENT_DATE BETWEEN week_start AND week_end
    ),

    previous_week AS (
      SELECT week_id, week_number, year
      FROM calendar_weeks
      WHERE week_id = (
        SELECT week_id FROM current_week
      ) - 1
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
    AND arl.week_id = pw.week_id
  
    WHERE 
      a.isactive = true
      AND a.asset_class = 'manufacturing'
      AND arl.runtime_log_id IS NULL;
  `);

  return res.status(200).json({
    missingAssets: result.rows,
    hasMissing: result.rows.length > 0,
    week: result.rows[0]?.week_number || null,
    year: result.rows[0]?.year || null
  });
}
      // ===============================
// ✅ DASHBOARD RUNTIME (NEW)
// ===============================
if (type === "dashboard-runtime") {

  const result = await pool.query(`
   WITH latest_logged_week AS (
  SELECT MAX(week_id) AS week_id
  FROM asset_runtime_logs
),

previous_weeks AS (
  SELECT week_id
  FROM calendar_weeks
  WHERE week_id <= (SELECT week_id FROM latest_logged_week)
  ORDER BY week_id DESC
  LIMIT 3
),

runtime_agg AS (
  SELECT
    arl.asset_id,

    -- ✅ MOST RECENT LOGGED WEEK (true "weekly")
    SUM(CASE 
        WHEN arl.week_id = (SELECT week_id FROM latest_logged_week)
        THEN arl.runtime_hours ELSE 0
    END) AS weekly,

    -- ✅ rolling average (last 3 logged weeks)
    AVG(CASE 
        WHEN arl.week_id IN (SELECT week_id FROM previous_weeks)
        THEN arl.runtime_hours
    END) AS rolling_avg

  FROM asset_runtime_logs arl
  GROUP BY arl.asset_id
)

SELECT
  a.assetid,
  a.assetname AS name,

  -- ✅ weekly runtime (last entered week)
  COALESCE(r.weekly, 0) AS weekly,

  -- ✅ 3-week rolling avg
  ROUND(COALESCE(r.rolling_avg, 0), 1) AS rolling_avg,

  -- ✅ cumulative runtime (true total)
  a.total_runtime AS ytd,

  -- ✅ PM projection (example: every 500 hours)
  CASE
    WHEN r.rolling_avg > 0 THEN
      ROUND((500 - (a.total_runtime % 500)) / r.rolling_avg, 1)
    ELSE NULL
  END AS weeks_to_pm

FROM assets a
LEFT JOIN runtime_agg r
  ON r.asset_id = a.assetid

WHERE a.isactive = true
  AND a.asset_class = 'manufacturing'

ORDER BY a.assetname;
`);

  return res.status(200).json({
    assets: result.rows
  });
}

  } catch (err) {
    console.error("REPORT ERROR:", err);

    return res.status(500).json({
      error: err.message || "Server error"
    });
  }

}
