export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ======================================================
   Utility helpers (local plant time: America/Chicago)
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
  d.setHours(0, 0, 0, 0);
  return d;
}

/* ======================================================
   Helper: check if PM instance already exists
   ====================================================== */

async function pmInstanceExists(pool, templateId, blockId) {
  const res = await pool.query(
    `
    SELECT pm_instance_id
    FROM pm_instances
    WHERE pm_template_id = $1
      AND pm_block_id = $2
      AND status = 'active'
    `,
    [templateId, blockId]
  );
  return res.rowCount > 0;
}

/* ======================================================
   Main handler
   ====================================================== */

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
    const url = new URL(req.url, "http://localhost");
    const action = url.searchParams.get("action");

    /* ======================================================
       POST /api/pm?action=run
       PHASE 1 + PHASE 2
       ====================================================== */
    if (req.method === "POST" && action === "run") {
      const today = getLocalToday();

      /* ------------------------------------------
         Load manufacturing assets with PM templates
         ------------------------------------------ */
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
        /* ------------------------------------------
           Load PM blocks
           ------------------------------------------ */
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

        /* ------------------------------------------
           Determine current PM block
           ------------------------------------------ */
        const runtime = Number(asset.runtime_hours);
        let currentBlock = null;

        for (const block of blocksResult.rows) {
          if (runtime < block.block_hours) {
            currentBlock = block;
            break;
          }
        }

        // Wrap after highest block (8000)
        if (!currentBlock) {
          currentBlock = blocksResult.rows[0];
        }

        /* ------------------------------------------
           Forecast Due Friday (temporary avg)
           ------------------------------------------ */
        const AVG_HOURS_PER_WEEK = 100; // placeholder until weekly data wired
        const hoursRemaining = currentBlock.block_hours - runtime;
        const weeksToDue = hoursRemaining / AVG_HOURS_PER_WEEK;

        const estimatedDueDate = addDays(
          today,
          Math.round(weeksToDue * 7)
        );

        const dueFriday = getDueFriday(estimatedDueDate);
        const generationDate = addDays(dueFriday, -21);
        const executionStart = addDays(dueFriday, -11);
        const executionEnd = addDays(dueFriday, 9);

        /* ------------------------------------------
           Determine PM phase
           ------------------------------------------ */
        let phase = "planning";

        if (today >= executionStart && today <= executionEnd) {
          phase = "execution";
        } else if (today > executionEnd) {
          phase = "auto-complete";
        }

        /* ------------------------------------------
           PHASE 2: Create PM instance + WO (planning)
           ------------------------------------------ */
        let actionTaken = null;

        if (phase === "planning" && today >= generationDate) {
          const exists = await pmInstanceExists(
            pool,
            asset.pm_template_id,
            currentBlock.pm_block_id
          );

          if (!exists) {
            /* Create PM instance */
            const pmInstanceResult = await pool.query(
              `
              INSERT INTO pm_instances (
                pm_template_id,
                asset_id,
                pm_block_id,
                trigger_value,
                status,
                auto_completed,
                created_at
              )
              VALUES ($1, $2, $3, $4, 'active', false, NOW())
              RETURNING pm_instance_id
              `,
              [
                asset.pm_template_id,
                asset.assetid,
                currentBlock.pm_block_id,
                currentBlock.block_hours
              ]
            );

            const pmInstanceId =
              pmInstanceResult.rows[0].pm_instance_id;

            /* Create Work Order */
            const woResult = await pool.query(
              `
              INSERT INTO workorders (
                assetid,
                description,
                status,
                pm_instance_id
              )
              VALUES ($1, $2, 1, $3)
              RETURNING woid
              `,
              [
                asset.assetid,
                `${currentBlock.block_hours}-Hour Preventive Maintenance`,
                pmInstanceId
              ]
            );

            actionTaken = `PM instance ${pmInstanceId} and WO ${woResult.rows[0].woid} created`;
          }
        }

        evaluations.push({
          assetid: asset.assetid,
          pm_block_hours: currentBlock.block_hours,
          runtime_hours: runtime,
          due_friday: dueFriday.toISOString().slice(0, 10),
          generation_date: generationDate.toISOString().slice(0, 10),
          execution_start: executionStart.toISOString().slice(0, 10),
          execution_end: executionEnd.toISOString().slice(0, 10),
          phase,
          action_taken: actionTaken
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
