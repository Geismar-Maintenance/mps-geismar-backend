export const runtime = "nodejs";

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
  const action = req.query.action;

 /* ======================================================
     POST /api/pm/run
     PHASE 1: DISCOVERY / DRY RUN
     ====================================================== */
  if (req.method === "POST" && action === "run")) {
    const today = getLocalToday();

    try {
      // ✅ PHASE 1 PM ENGINE LOGIC STARTS HERE

      // 1. Load manufacturing assets + PM templates
      const assetsResult = await pool.query(`
        SELECT
          a.assetid,
          a.runtime_hours,
          pt.pm_template_id
        FROM assets a
        JOIN pm_templates pt
          ON pt.asset_id = a.assetid
        WHERE
          a.asset_class = 'manufacturing'
          AND pt.pm_engine_type = 'cyclical'
          AND pt.active = true
      `);

      const evaluations = [];

      for (const asset of assetsResult.rows) {
        // 2. Load PM blocks
        const blocksResult = await pool.query(
          `
          SELECT
            pm_block_id,
            block_hours,
            sequence_order
          FROM pm_blocks
          WHERE pm_template_id = $1
          ORDER BY sequence_order
          `,
          [asset.pm_template_id]
        );

        if (blocksResult.rowCount === 0) {
          evaluations.push({
            assetid: asset.assetid,
            warning: "No PM blocks defined"
          });
          continue;
        }

        // 3. Determine current block
        const runtime = Number(asset.runtime_hours);
        let currentBlock = null;

        for (const block of blocksResult.rows) {
          if (runtime < block.block_hours) {
            currentBlock = block;
            break;
          }
        }

        if (!currentBlock) {
          currentBlock = blocksResult.rows[0]; // wrap after 8000
        }

        // 4. Forecast due Friday (temporary avg)
        const AVG_HOURS_PER_WEEK = 100;
        const hoursRemaining = currentBlock.block_hours - runtime;
        const weeksToDue = hoursRemaining / AVG_HOURS_PER_WEEK;

        const estimatedDueDate = addDays(
          today,
          Math.round(weeksToDue * 7)
        );

        const dueFriday = getDueFriday(estimatedDueDate);

        // 5. Execution windows
        const generationDate = addDays(dueFriday, -21);
        const executionStart = addDays(dueFriday, -11);
        const executionEnd = addDays(dueFriday, 9);

        // 6. Determine PM phase
        let phase = "planning";
        if (today >= executionStart && today <= executionEnd) {
          phase = "execution";
        } else if (today > executionEnd) {
          phase = "auto-complete";
        }

        evaluations.push({
          assetid: asset.assetid,
          pm_block_hours: currentBlock.block_hours,
          runtime_hours: runtime,
          due_friday: dueFriday.toISOString().slice(0, 10),
          execution_start: executionStart.toISOString().slice(0, 10),
          execution_end: executionEnd.toISOString().slice(0, 10),
          phase
        });
      }

      return res.status(200).json({
        success: true,
        run_date: today.toISOString().slice(0, 10),
        evaluated_assets: evaluations.length,
        evaluations
      });

    } catch (err) {
      console.error("PM ENGINE PHASE 1 ERROR:", err);
      return res.status(500).json({
        error: "PM engine discovery failed"
      });
    }
  }

  /* ======================================================
     GET /api/pm/status
     READ-ONLY PM VISIBILITY (FUTURE UI)
     ====================================================== */
  if (req.method === "GET" && req.url.endsWith("/status")) {
    try {
      // 🔒 PM visibility logic will live here
      // Placeholder only for now

      return res.status(200).json({
        success: true,
        message: "PM status placeholder"
      });

    } catch (err) {
      console.error("PM STATUS ERROR:", err);
      return res.status(500).json({
        error: "Failed to load PM status"
      });
    }
  }

  /* ======================================================
     FALLBACK
     ====================================================== */
  return res.status(405).json({
    error: "Method not allowed"
  });
}
``
