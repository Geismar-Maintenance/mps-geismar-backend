export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ======================================================
   Date helpers (local plant time)
   ====================================================== */

function getLocalToday() {
  const now = new Date();
  const local = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Chicago" })
  );
  local.setHours(0, 0, 0, 0);
  return local;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDueFriday(date) {
  const d = new Date(date);
  const day = d.getDay(); // Sun=0 ... Fri=5
  const diff = 5 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/* ======================================================
   Helper: check PM instance existence
   ====================================================== */

async function pmInstanceExists(pool, templateId, blockId) {
  const res = await pool.query(
    `
    SELECT 1
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
   MAIN HANDLER
   ====================================================== */

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
   GET /api/pm?action=status
   READ-ONLY PM STATUS (NO ENGINE LOGIC)
   ====================================================== */
if (req.method === "GET" && action === "status") {
  try {
    const result = await pool.query(`
      SELECT
        pi.pm_instance_id,
        pi.asset_id,
        a.assetname AS asset_name,
        pb.block_hours AS pm_block_hours,
        pi.status,
        pi.execution_allowed,
        pi.completion_percentage,
        pi.has_exceptions,
        pi.auto_completed,

        CASE
          WHEN pi.status = 'completed' THEN 'completed'
          WHEN pi.execution_allowed = true THEN 'execution'
          ELSE 'planning'
        END AS phase

      FROM pm_instances pi
      JOIN assets a
        ON a.assetid = pi.asset_id
      JOIN pm_blocks pb
        ON pb.pm_block_id = pi.pm_block_id
      ORDER BY
        pi.status,
        pb.block_hours,
        a.assetname;
    `);

    return res.status(200).json(result.rows);

  } catch (err) {
    console.error("PM STATUS ERROR:", err);
    return res.status(500).json({
      error: "Failed to load PM status"
    });
  }
}
    
    /* ======================================================
       POST /api/pm?action=run
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

        if (!currentBlock) {
          currentBlock = blocksResult.rows[0]; // wrap after 8000
        }

        /* ------------------------------------------
           Forecast due dates
           ------------------------------------------ */
        const AVG_HOURS_PER_WEEK = 100;
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
           Phase classification
           ------------------------------------------ */
        let phase = "planning";

        if (today >= executionStart && today <= executionEnd) {
          phase = "execution";
        } else if (today > executionEnd) {
          phase = "auto-complete";
        }

        /* ------------------------------------------
           PHASE 3: Execution window enforcement
           ------------------------------------------ */
        const executionAllowed =
          today >= executionStart && today <= executionEnd;

        await pool.query(
          `
          UPDATE pm_instances
          SET execution_allowed = $1
          WHERE pm_template_id = $2
            AND pm_block_id = $3
            AND status = 'active'
          `,
          [
            executionAllowed,
            asset.pm_template_id,
            currentBlock.pm_block_id
          ]
        );

        /* ------------------------------------------
           PHASE 2: Create PM + WO (planning)
           ------------------------------------------ */
        let actionTaken = null;

        if (phase === "planning" && today >= generationDate) {
          const exists = await pmInstanceExists(
            pool,
            asset.pm_template_id,
            currentBlock.pm_block_id
          );

          if (!exists) {
            const pmInstanceResult = await pool.query(
              `
              INSERT INTO pm_instances (
                pm_template_id,
                asset_id,
                pm_block_id,
                trigger_value,
                status,
                auto_completed,
                execution_allowed,
                created_at
              )
              VALUES ($1, $2, $3, $4, 'active', false, false, NOW())
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

            const PM_TYPE_ID = 1;
            const PM_PRIORITY_ID = 2;

            const woResult = await pool.query(
              `
              INSERT INTO workorders (
                assetid,
                description,
                wotype,
                priority,
                duedate,
                status,
                pm_instance_id
              )
              VALUES ($1, $2, $3, $4, $5, 1, $6)
              RETURNING woid
              `,
              [
                asset.assetid,
                `${currentBlock.block_hours}-Hour Preventive Maintenance`,
                PM_TYPE_ID,
                PM_PRIORITY_ID,
                dueFriday,
                pmInstanceId
              ]
            );

            actionTaken = `PM ${pmInstanceId}, WO ${woResult.rows[0].woid} created`;
          }
        }

        /* ------------------------------------------
           PHASE 4: Auto-completion (late PMs)
           ------------------------------------------ */
        if (phase === "auto-complete") {
          const alreadyCompleted = await pool.query(
            `
            SELECT 1
            FROM pm_instances
            WHERE pm_template_id = $1
              AND pm_block_id = $2
              AND status = 'completed'
            `,
            [asset.pm_template_id, currentBlock.pm_block_id]
          );

          if (alreadyCompleted.rowCount === 0) {

            const completionResult = await pool.query(
              `
              SELECT
                COUNT(*) FILTER (WHERE pti.completed = true)::FLOAT
                /
                NULLIF(COUNT(*), 0) * 100 AS completion_percentage
              FROM pm_task_instances pti
              JOIN pm_instances pi
                ON pi.pm_instance_id = pti.pm_instance_id
              WHERE
                pi.pm_template_id = $1
                AND pi.pm_block_id = $2
                AND pi.status = 'active'
              `,
              [asset.pm_template_id, currentBlock.pm_block_id]
            );

            const completionPercentage =
              completionResult.rows[0].completion_percentage || 0;

            let hasExceptions = false;
            try {
              const ex = await pool.query(
                `
                SELECT COUNT(*) AS cnt
                FROM pm_task_requirement_instances pri
                JOIN pm_task_instances pti
                  ON pti.pm_task_instance_id = pri.pm_task_instance_id
                JOIN pm_instances pi
                  ON pi.pm_instance_id = pti.pm_instance_id
                WHERE
                  pi.pm_template_id = $1
                  AND pi.pm_block_id = $2
                  AND pri.has_exception = true
                `,
                [asset.pm_template_id, currentBlock.pm_block_id]
              );
              hasExceptions = Number(ex.rows[0].cnt) > 0;
            } catch {}

            await pool.query(
              `
              UPDATE pm_instances
              SET
                status = 'completed',
                auto_completed = true,
                completion_type = 'auto',
                completed_at = $3,
                completion_percentage = $4,
                execution_allowed = false,
                has_exceptions = $5
              WHERE
                pm_template_id = $1
                AND pm_block_id = $2
                AND status = 'active'
              `,
              [
                asset.pm_template_id,
                currentBlock.pm_block_id,
                executionEnd,
                completionPercentage,
                hasExceptions
              ]
            );
          }
        }

        evaluations.push({
          assetid: asset.assetid,
          pm_block_hours: currentBlock.block_hours,
          runtime_hours: runtime,
          due_friday: dueFriday.toISOString().slice(0, 10),
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

