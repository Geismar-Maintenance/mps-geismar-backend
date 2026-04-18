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

async function pmInstanceExists(templateId, blockId) {
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

       /* ------------------------------------------
           Get PM Templates
           ------------------------------------------ */
if (req.method === 'GET' && action === 'adminLoad') {
  try {
    const templates = await pool.query(`
      SELECT
        pt.pm_template_id,
        a.assetname,
        pt.pm_engine_type,
        pt.active
      FROM pm_templates pt
      JOIN assets a ON a.assetid = pt.asset_id
      ORDER BY a.assetname
    `);

    const tiers = await pool.query(`
      SELECT
        pm_task_tier_id,
        tier_name,
        tier_order
      FROM pm_task_tiers
      ORDER BY tier_order
    `);

    return res.status(200).json({
      templates: templates.rows,
      tiers: tiers.rows
    });

  } catch (err) {
    console.error('PM adminLoad error:', err);
    return res.status(500).json({ error: 'Failed to load PM admin data' });
  }
}

    /* ================================
   ADMIN: TEMPLATE HEALTH CHECK
   ================================ */
if (req.method === "GET" && action === "templateHealth") {
  const templateId = Number(req.query.templateId);
  const warnings = [];

  try {
    const blocks = await pool.query(
      `SELECT 1 FROM pm_blocks WHERE pm_template_id = $1 LIMIT 1`,
      [templateId]
    );
    if (blocks.rowCount === 0) {
      warnings.push("No trigger blocks defined");
    }

    const tasks = await pool.query(
      `SELECT 1 FROM pm_task_templates WHERE pm_template_id = $1 LIMIT 1`,
      [templateId]
    );
    if (tasks.rowCount === 0) {
      warnings.push("No PM tasks defined");
    }

    return res.status(200).json({ warnings });

  } catch (err) {
    console.error("Template health error:", err);
    return res.status(500).json({ error: "Failed to evaluate template health" });
  }
}

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
    if (req.method === "GET" && action === "getBlocks") {
  const templateId = Number(req.query.templateId);

  const blocks = await pool.query(`
    SELECT
      pm_block_id,
      block_hours,
      sequence_order
    FROM pm_blocks
    WHERE pm_template_id = $1
    ORDER BY sequence_order
  `, [templateId]);

  return res.status(200).json({ blocks: blocks.rows });
}

    if (req.method === "POST" && action === "addBlock") {
  const { pm_template_id, block_hours, sequence_order } = req.body;

  await pool.query(
    `
    INSERT INTO pm_blocks
      (pm_template_id, block_hours, sequence_order)
    VALUES ($1, $2, $3)
    `,
    [pm_template_id, block_hours, sequence_order]
  );

  return res.status(200).json({ success: true });
}

 if (req.method === "POST" && action === "removeBlock") {
  const { pm_block_id } = req.body;

  const exists = await pool.query(`
    SELECT 1 FROM pm_instances
    WHERE pm_block_id = $1
      AND status = 'active'
  `, [pm_block_id]);

  if (exists.rowCount > 0) {
    return res.status(409).json({
      error: "Cannot remove block with active PM instances"
    });
  }

  await pool.query(
    `DELETE FROM pm_blocks WHERE pm_block_id = $1`,
    [pm_block_id]
  );

  return res.status(200).json({ success: true });
}   

    if (req.method === "GET" && action === "getTaskTiers") {
  const tiers = await pool.query(`
    SELECT
      pm_task_tier_id,
      tier_name,
      tier_order
    FROM pm_task_tiers
    ORDER BY tier_order
  `);

  return res.status(200).json({ tiers: tiers.rows });
}

if (req.method === "POST" && action === "addTaskTier") {
  const { pm_template_id, tier_name, tier_order } = req.body;

  await pool.query(
    `
    INSERT INTO pm_task_tiers (
      tier_name,
      tier_order
    )
    VALUES ($1, $2)
    `,
    [tier_name, tier_order]
  );

  return res.status(200).json({ success: true });
}
    if (req.method === "POST" && action === "removeTaskTier") {
  const { pm_task_tier_id } = req.body;

  const used = await pool.query(
    `
    SELECT 1
    FROM pm_task_templates
    WHERE pm_task_tier_id = $1
    LIMIT 1
    `,
    [pm_task_tier_id]
  );

  if (used.rowCount > 0) {
    return res.status(409).json({
      error: "Task tier in use"
    });
  }

  await pool.query(
    `DELETE FROM pm_task_tiers WHERE pm_task_tier_id = $1`,
    [pm_task_tier_id]
  );

  return res.status(200).json({ success: true });
}

    if (req.method === "GET" && action === "getTasks") {
  const templateId = Number(req.query.templateId);

  const tasks = await pool.query(`
    SELECT
      t.pm_task_template_id,
      t.task_description,
      t.discipline,
      tr.tier_name
    FROM pm_task_templates t
    JOIN pm_task_tiers tr
      ON tr.pm_task_tier_id = t.pm_task_tier_id
    WHERE t.pm_template_id = $1
      AND t.active = true
    ORDER BY tr.tier_order, t.sequence_order
  `, [templateId]);

  return res.status(200).json({ tasks: tasks.rows });
}

    if (req.method === "POST" && action === "addTask") {
  const {
    pm_template_id,
    pm_task_tier_id,
    task_description,
    discipline,
    sequence_order
  } = req.body;

  await pool.query(`
    INSERT INTO pm_task_templates (
      pm_template_id,
      pm_task_tier_id,
      task_description,
      discipline,
      sequence_order,
      active
    )
    VALUES ($1, $2, $3, $4, $5, true)
  `, [
    pm_template_id,
    pm_task_tier_id,
    task_description,
    discipline,
    sequence_order
  ]);

  return res.status(200).json({ success: true });
}

    if (req.method === "GET" && action === "getTaskRequirements") {
  const taskId = Number(req.query.taskId);

  const result = await pool.query(
    `
    SELECT
      pm_task_requirement_id,
      requirement_name,
      sequence_order,
      requires_reading
    FROM pm_task_requirements
    WHERE pm_task_template_id = $1
    ORDER BY sequence_order
    `,
    [taskId]
  );

  return res.status(200).json({ requirements: result.rows });
}
    if (req.method === "POST" && action === "addTaskRequirement") {
  const {
    pm_task_template_id,
    requirement_name,
    sequence_order,
    requires_reading
  } = req.body;

  await pool.query(
    `
    INSERT INTO pm_task_requirements (
      pm_task_template_id,
      requirement_name,
      sequence_order,
      requires_reading
    )
    VALUES ($1, $2, $3, $4)
    `,
    [
      pm_task_template_id,
      requirement_name,
      sequence_order,
      requires_reading
    ]
  );

  return res.status(200).json({ success: true });
}
  if (req.method === "POST" && action === "removeTaskRequirement") {
  const { pm_task_requirement_id } = req.body;

  await pool.query(
    `
    DELETE FROM pm_task_requirements
    WHERE pm_task_requirement_id = $1
    `,
    [pm_task_requirement_id]
  );

  return res.status(200).json({ success: true });
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

