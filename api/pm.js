export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ======================================================
   Utility helpers (local plant time)
   ====================================================== */

function getLocalToday() {
  const now = new Date();
  const local = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Chicago" })
  );
  local.setHours(0, 0, 0, 0);
  return local;
}

function getDueFriday(date) {
  const d = new Date(date);
  const day = d.getDay(); // Sun=0 ... Fri=5
  const diff = 5 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const action = url.searchParams.get("action");

    /* ======================================================
       POST /api/pm?action=run
       PHASE 1: PM DISCOVERY (DRY RUN)
       ====================================================== */
    if (req.method === "POST" && action === "run") {
      const today = getLocalToday();

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

        // Temporary avg until weekly data is wired
        const AVG_HOURS_PER_WEEK = 100;
        const hoursRemaining = currentBlock.block_hours - runtime;
        const weeksToDue = hoursRemaining / AVG_HOURS_PER_WEEK;

        const estimatedDueDate = addDays(
          today,
          Math.round(weeksToDue * 7)
        );

        const dueFriday = getDueFriday(estimatedDueDate);
        const executionStart = addDays(dueFriday, -11);
        const executionEnd = addDays(dueFriday, 9);
        const generationDate = addDays(dueFriday, -21);

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
          generation_date: generationDate.toISOString().slice(0, 10),
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
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("PM ENGINE ERROR:", err);
    return res.status(500).json({ error: "PM engine failed" });
  }
}
