import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  /* ==========================
     CORS
     ========================== */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    /* ======================================================
       GET – WORK ORDERS
       ====================================================== */
    if (req.method === "GET") {

     /* ---------- HISTORY MODE (READ-ONLY) ---------- */
if (req.query.history === "true") {
  const result = await pool.query(`
    SELECT
      w.woid,
      a.assetname,
      w.description,
      wt.type AS type,
      p.priority AS priority,
      s.status AS status,
      w.opendate,
      w.closeddate,
      w.workperformed
    FROM workorders w
    LEFT JOIN assets a ON a.assetid = w.assetid
    LEFT JOIN wotypes wt ON wt.id = w.wotype
    LEFT JOIN wopriorities p ON p.id = w.priority
    INNER JOIN wostatus s ON s.id = w.status
    WHERE s.status = 'Completed', 'Closed'
    ORDER BY w.closeddate DESC
    LIMIT 500
  `);

  return res.status(200).json(result.rows);
}
      /* ---------- DEFAULT (ACTIVE / ALL) ---------- */
      const result = await pool.query(`
        SELECT
          w.woid,
          a.assetname,
          w.description,
          wt.type AS type,
          p.priority AS priority,
          s.status AS status,
          w.duedate
        FROM workorders w
        LEFT JOIN assets a ON a.assetid = w.assetid
        LEFT JOIN wotypes wt ON wt.id = w.wotype
        LEFT JOIN wopriorities p ON p.id = w.priority
        LEFT JOIN wostatus s ON s.id = w.status
        ORDER BY w.opendate DESC
      `);

      return res.status(200).json(result.rows);
    }

    /* ======================================================
       POST – CREATE OR CLOSE WORK ORDER
       ====================================================== */
    if (req.method === "POST") {
      const { action } = req.body;

      /* ---------- CREATE WORK ORDER ---------- */
      if (!action || action === "create") {
        const { assetid, description, wotype, priority, duedate } = req.body;

        if (!assetid || !description || !wotype || !priority) {
          return res.status(400).json({
            error: "assetid, description, wotype, and priority are required"
          });
        }

        const result = await pool.query(
          `
          INSERT INTO workorders
            (assetid, description, wotype, priority, status, duedate)
          VALUES
            ($1, $2, $3, $4, 1, $5)
          RETURNING woid
          `,
          [assetid, description, wotype, priority, duedate || null]
        );

        return res.status(201).json(result.rows[0]);
      }

      /* ---------- CLOSE WORK ORDER ---------- */
      if (action === "close") {
        const { woid, workperformed } = req.body;

        if (!woid || !workperformed || !workperformed.trim()) {
          return res.status(400).json({
            error: "woid and workperformed are required"
          });
        }

        const check = await pool.query(
          `SELECT status FROM workorders WHERE woid = $1`,
          [woid]
        );

        if (check.rowCount === 0) {
          return res.status(404).json({ error: "Work order not found" });
        }

        if (check.rows[0].status !== 1) {
          return res.status(409).json({
            error: "Work order is already closed"
          });
        }

        await pool.query(
          `
          UPDATE workorders
          SET
            workperformed = $1,
            status = 2,
            closeddate = CURRENT_DATE,
            islate = (
              duedate IS NOT NULL AND CURRENT_DATE > duedate
            )
          WHERE woid = $2
          `,
          [workperformed.trim(), woid]
        );

        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: "Invalid action" });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("Workorders API error:", err);
    return res.status(500).json({ error: err.message });
  }
}
