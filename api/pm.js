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

async function pmInstanceExists(templateId, triggerValue) {
  const res = await pool.query(
    `
    SELECT 1
    FROM pm_instances
    WHERE pm_template_id = $1
      AND trigger_value = $2
      AND status = 'active'
    `,
    [templateId, triggerValue]
  );
  return res.rowCount > 0;
}

/* ======================================================
   MAIN HANDLER (ROUTER)
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

    /* ===========================
       ADMIN
       =========================== */

    if (req.method === "GET" && action === "adminLoad")
      return handleAdminLoad(req, res);

    if (req.method === "POST" && action === "addTemplate")
      return handleAddTemplate(req, res);
    
    if (req.method === "GET" && action === "getTriggers")
      return handleGetTriggers(req, res);
    
    if (req.method === "GET" && action === "getTemplateTriggers")
      return handleGetTemplateTriggers(req, res);

    if (req.method === "POST" && action === "createTrigger")
      return handleCreateTrigger(req, res);

    if (req.method === "POST" && action === "linkTriggerTemplate")
      return handleLinkTriggerTemplate(req, res);

    if (req.method === "POST" && action === "unlinkTriggerTemplate")
      return handleUnlinkTriggerTemplate(req, res);

    if (req.method === "GET" && action === "templateHealth")
      return handleTemplateHealth(req, res);

    if (req.method === "GET" && action === "getTaskTiers")
      return handleGetTaskTiers(req, res);

    if (req.method === "POST" && action === "addTaskTier")
      return handleAddTaskTier(req, res);

    if (req.method === "POST" && action === "removeTaskTier")
      return handleRemoveTaskTier(req, res);

    if (req.method === "GET" && action === "getTasks")
      return handleGetTasks(req, res);

    if (req.method === "POST" && action === "addTask")
      return handleAddTask(req, res);

    if (req.method === "GET" && action === "getTaskRequirements")
      return handleGetTaskRequirements(req, res);

    if (req.method === "POST" && action === "addTaskRequirement")
      return handleAddTaskRequirement(req, res);

    if (req.method === "POST" && action === "removeTaskRequirement")
      return handleRemoveTaskRequirement(req, res);

    /* ===========================
       STATUS
       =========================== */

    if (req.method === "GET" && action === "status")
      return handleStatus(req, res);

    /* ===========================
       ENGINE
       =========================== */

    if (req.method === "POST" && action === "run")
      return handleEngineRun(req, res);

    /* ===========================
       REPORTS (NEW)
       =========================== */

    if (req.method === "GET" && action === "visualBoard")
      return handleVisualBoard(req, res);

    /* ===========================
       PREVIEW
       =========================== */

    if (req.method === "GET" && action === "previewTemplate")
      return handlePreviewTemplate(req, res);

    /* ===========================
       FALLBACK
       =========================== */

    return res.status(400).json({ error: "Invalid action" });

  } catch (err) {
    console.error("PM HANDLER ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
       /* ------------------------------------------
           Get PM Templates
           ------------------------------------------ */
async function handleAdminLoad(req, res) {
  try {

    const templates = await pool.query(`
     async function handleAdminLoad(req, res) {
  try {

    const templates = await pool.query(`
  SELECT
  pt.pm_template_id,
  pt.description,
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
    console.error("PM adminLoad error:", err);
    return res.status(500).json({
      error: "Failed to load PM admin data"
    });
  }
}

    /* ------------------------------------------
   ADD PM TEMPLATE
------------------------------------------ */
async function handleAddTemplate(req, res) {
  const {
    asset_id,
    pm_engine_type,
    description
  } = req.body;

  try {
    const result = await pool.query(
      `
      INSERT INTO pm_templates (
        asset_id,
        pm_engine_type,
        description,
        active,
        created_at
      )
      VALUES ($1, $2, $3, true, NOW())
      RETURNING pm_template_id
      `,
      [asset_id, pm_engine_type, description]
    );

    return res.status(200).json({
      success: true,
      pm_template_id: result.rows[0].pm_template_id
    });

  } catch (err) {
    console.error("Add template error:", err);
    return res.status(500).json({
      error: "Failed to create PM template"
    });
  }
}

    /* ================================
   ADMIN: TEMPLATE HEALTH CHECK
   ================================ */
async function handleTemplateHealth(req, res) {
  const templateId = Number(req.query.templateId);
  const warnings = [];

  try {
    const blocks = await pool.query(`     
SELECT 1
FROM trigger_block_templates
WHERE pm_template_id = $1
 LIMIT 1`,
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
async function handleStatus(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        pi.pm_instance_id,
        pi.asset_id,
        a.assetname AS asset_name,
        tb.interval_value AS trigger_value,
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
      JOIN trigger_blocks tb
      ON tb.interval_value = pi.trigger_value

      ORDER BY
        pi.status,
        tb.interval_value,
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
   BLOCKS
   ====================================================== */
  
async function handleGetTemplateTriggers(req, res) {
  const templateId = Number(req.query.templateId);

  if (!templateId) {
    return res.status(400).json({
      error: "Template ID is required"
    });
  }

  try {
    const result = await pool.query(`
      SELECT
        tb.trigger_block_id,
        tb.name,
        tb.trigger_type,
        tb.interval_value,
        tb.sequence_order,
        tb.max_tier_order
      FROM trigger_block_templates tbt
      JOIN trigger_blocks tb
        ON tb.trigger_block_id = tbt.trigger_block_id
      WHERE tbt.pm_template_id = $1
      ORDER BY tb.interval_value
    `, [templateId]);

    return res.status(200).json({
      triggers: result.rows
    });

  } catch (err) {
    console.error("Get template triggers error:", err);
    return res.status(500).json({
      error: "Failed to load template triggers"
    });
  }
}
/* ======================================================
   TASK TIERS
   ====================================================== */

async function handleGetTaskTiers(req, res) {
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

async function handleAddTaskTier(req, res) {
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
async function handleRemoveTaskTier(req, res) {
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


/* ======================================================
   TASKS
   ====================================================== */
async function handleGetTasks(req, res) {
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

async function handleAddTask(req, res) {
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


/* ======================================================
   TASK REQUIREMENTS
   ====================================================== */
async function handleGetTaskRequirements(req, res) {
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
async function handleAddTaskRequirement(req, res) {
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
async function handleRemoveTaskRequirement(req, res) {
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
async function handleEngineRun(req, res) {
  const today = getLocalToday();

  const assetsResult = await pool.query(`
    SELECT
      a.assetid,
      a.runtime_hours
    FROM assets a
    WHERE a.asset_class = 'manufacturing'
  `);

  const triggerResult = await pool.query(`
    SELECT
      trigger_block_id,
      trigger_type,
      interval_value,
      sequence_order,
      max_tier_order
    FROM trigger_blocks
    ORDER BY sequence_order
  `);

  const evaluations = [];

  for (const asset of assetsResult.rows) {

    if (triggerResult.rowCount === 0) {
      evaluations.push({
        assetid: asset.assetid,
        warning: "No trigger blocks defined"
      });
      continue;
    }

    /* ------------------------------------------
       Determine current trigger
    ------------------------------------------ */
    const runtime = Number(asset.runtime_hours);
    let currentTrigger = null;

    for (const trigger of triggerResult.rows) {
      if (trigger.trigger_type === "runtime") {
        if (runtime < trigger.interval_value) {
          currentTrigger = trigger;
          break;
        }
      }
    }

    if (!currentTrigger) {
      currentTrigger = triggerResult.rows[0];
    }

    const maxTierOrder = currentTrigger.max_tier_order;

    /* ------------------------------------------
       Get templates for this trigger + asset
    ------------------------------------------ */
    const templates = await pool.query(`
      SELECT pt.*
      FROM trigger_block_templates tbt
      JOIN pm_templates pt
        ON pt.pm_template_id = tbt.pm_template_id
      WHERE tbt.trigger_block_id = $1
        AND pt.asset_id = $2
        AND pt.active = true
    `, [currentTrigger.trigger_block_id, asset.assetid]);

    if (templates.rowCount === 0) continue;

    /* ------------------------------------------
       Forecast due dates
    ------------------------------------------ */
    const AVG_HOURS_PER_WEEK = 100;
    const hoursRemaining = currentTrigger.interval_value - runtime;
    const weeksToDue = hoursRemaining / AVG_HOURS_PER_WEEK;

    const estimatedDueDate = addDays(
      today,
      Math.round(weeksToDue * 7)
    );

    const dueFriday = getDueFriday(estimatedDueDate);
    const generationDate = addDays(dueFriday, -21);
    const executionStart = addDays(dueFriday, -11);
    const executionEnd = addDays(dueFriday, 9);

    let phase = "planning";

    if (today >= executionStart && today <= executionEnd) {
      phase = "execution";
    } else if (today > executionEnd) {
      phase = "auto-complete";
    }

    const executionAllowed =
      today >= executionStart && today <= executionEnd;

    /* ------------------------------------------
       Loop templates (NEW CORE STRUCTURE)
    ------------------------------------------ */
    for (const template of templates.rows) {

      /* ------------------------------------------
         Update execution window
      ------------------------------------------ */
      await pool.query(
        `
        UPDATE pm_instances
        SET execution_allowed = $1
        WHERE pm_template_id = $2
          AND trigger_value = $3
          AND status = 'active'
        `,
        [
          executionAllowed,
          template.pm_template_id,
          currentTrigger.interval_value
        ]
      );

      /* ------------------------------------------
         Check existence
      ------------------------------------------ */
      const exists = await pool.query(
        `
        SELECT 1
        FROM pm_instances
        WHERE pm_template_id = $1
          AND trigger_value = $2
          AND status = 'active'
        LIMIT 1
        `,
        [
          template.pm_template_id,
          currentTrigger.interval_value
        ]
      );

      let actionTaken = null;

      /* ------------------------------------------
         Create PM
      ------------------------------------------ */
      if (phase === "planning" && today >= generationDate && exists.rowCount === 0) {

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
            template.pm_template_id,
            asset.assetid,
            currentTrigger.interval_value, // temporary mapping
            currentTrigger.interval_value
          ]
        );

        const pmInstanceId = pmInstanceResult.rows[0].pm_instance_id;

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
          VALUES ($1, $2, 1, 2, $3, 1, $4)
          RETURNING woid
          `,
          [
            asset.assetid,
            `${currentTrigger.interval_value}-Hour Preventive Maintenance`,
            dueFriday,
            pmInstanceId
          ]
        );

        /* ------------------------------------------
           Create task instances
        ------------------------------------------ */
        await pool.query(
          `
          INSERT INTO pm_task_instances (
            pm_instance_id,
            pm_task_template_id,
            completed
          )
          SELECT
            $1,
            t.pm_task_template_id,
            false
          FROM pm_task_templates t
          JOIN pm_task_tiers tier
            ON tier.pm_task_tier_id = t.pm_task_tier_id
          WHERE
            t.pm_template_id = $2
            AND tier.tier_order <= $3
          `,
          [
            pmInstanceId,
            template.pm_template_id,
            maxTierOrder
          ]
        );

        await pool.query(
          `
          INSERT INTO pm_task_requirement_instances (
            pm_task_instance_id,
            pm_task_requirement_id,
            completed,
            has_exception
          )
          SELECT
            pti.pm_task_instance_id,
            r.pm_task_requirement_id,
            false,
            false
          FROM pm_task_instances pti
          JOIN pm_task_requirements r
            ON r.pm_task_template_id = pti.pm_task_template_id
          WHERE pti.pm_instance_id = $1
          `,
          [pmInstanceId]
        );

        actionTaken = `PM ${pmInstanceId}, WO ${woResult.rows[0].woid} created`;
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
      AND trigger_value = $2
      AND status = 'completed'
    `,
    [
      template.pm_template_id,
      currentTrigger.interval_value
    ]
  );

  if (alreadyCompleted.rowCount === 0) {

    /* ------------------------------------------
       Completion percentage
    ------------------------------------------ */
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
        AND pi.trigger_value = $2
        AND pi.status = 'active'
      `,
      [
        template.pm_template_id,
        currentTrigger.interval_value
      ]
    );

    const completionPercentage =
      completionResult.rows[0].completion_percentage || 0;

    /* ------------------------------------------
       Exception check
    ------------------------------------------ */
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
          AND pi.trigger_value = $2
          AND pri.has_exception = true
        `,
        [
          template.pm_template_id,
          currentTrigger.interval_value
        ]
      );

      hasExceptions = Number(ex.rows[0].cnt) > 0;
    } catch (err) {
      console.error("Exception check failed:", err);
    }

    /* ------------------------------------------
       Final update
    ------------------------------------------ */
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
        AND trigger_value = $2
        AND status = 'active'
      `,
      [
        template.pm_template_id,
        currentTrigger.interval_value,
        executionEnd,
        completionPercentage,
        hasExceptions
      ]
    );
  }
}

      evaluations.push({
        assetid: asset.assetid,
        trigger_value: currentTrigger.interval_value,
        runtime_hours: runtime,
        due_friday: dueFriday.toISOString().slice(0, 10),
        phase,
        action_taken: actionTaken
      });

    }
  }

  return res.status(200).json({
    success: true,
    run_date: today.toISOString().slice(0, 10),
    evaluated_assets: evaluations.length,
    evaluations
  });
}

    /* ------------------------------------------
   PREVIEW TEMPLATE (NO INSTANCE CREATION)
------------------------------------------ */
async function handlePreviewTemplate(req, res) {
  const templateId = Number(req.query.templateId);

  try {

    const tasks = await pool.query(`
      SELECT
        t.pm_task_template_id,
        t.task_description,
        t.discipline,
        t.sequence_order,
        tr.tier_name,
        tr.tier_order
      FROM pm_task_templates t
      JOIN pm_task_tiers tr
        ON tr.pm_task_tier_id = t.pm_task_tier_id
      WHERE t.pm_template_id = $1
        AND t.active = true
     
ORDER BY 
  tr.tier_order,
  CASE 
    WHEN t.discipline = 'mechanical' THEN 1
    WHEN t.discipline = 'electrical' THEN 2
    ELSE 3
  END,
  t.sequence_order

    `, [templateId]);

    const requirements = await pool.query(`
      SELECT
        pm_task_requirement_id,
        pm_task_template_id,
        requirement_name,
        sequence_order,
        requires_reading
      FROM pm_task_requirements
      WHERE pm_task_template_id IN (
        SELECT pm_task_template_id
        FROM pm_task_templates
        WHERE pm_template_id = $1
      )
      ORDER BY sequence_order
    `, [templateId]);

    return res.status(200).json({
      tasks: tasks.rows,
      requirements: requirements.rows
    });

  } catch (err) {
    console.error("Preview error:", err);
    return res.status(500).json({
      error: "Failed to load preview"
    });
  }
}
async function handleGetTriggers(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        trigger_block_id,
        name,
        trigger_type,
        interval_value,
        sequence_order,
        max_tier_order
      FROM trigger_blocks
      ORDER BY interval_value
    `);

    return res.status(200).json({
      triggers: result.rows
    });

  } catch (err) {
    console.error("Get triggers error:", err);
    return res.status(500).json({
      error: "Failed to load triggers"
    });
  }
}
async function handleCreateTrigger(req, res) {
  const {
    name,
    trigger_type,
    interval_value,
    sequence_order,
    max_tier_order
  } = req.body;

  if (!name || !interval_value || !sequence_order) {
    return res.status(400).json({
      error: "Missing required fields"
    });
  }

  try {
    const result = await pool.query(`
      INSERT INTO trigger_blocks (
        name,
        trigger_type,
        interval_value,
        sequence_order,
        max_tier_order
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING trigger_block_id
    `, [
      name,
      trigger_type || "runtime",
      interval_value,
      sequence_order,
      max_tier_order || 1
    ]);

    return res.status(200).json({
      success: true,
      trigger_block_id: result.rows[0].trigger_block_id
    });

  } catch (err) {
    console.error("Create trigger error:", err);
    return res.status(500).json({
      error: "Failed to create trigger"
    });
  }
}
async function handleLinkTriggerTemplate(req, res) {
  const { trigger_block_id, pm_template_id } = req.body;

  if (!trigger_block_id || !pm_template_id) {
    return res.status(400).json({
      error: "Missing trigger or template ID"
    });
  }

  try {
    await pool.query(`
      INSERT INTO trigger_block_templates (
        trigger_block_id,
        pm_template_id
      )
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [trigger_block_id, pm_template_id]);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("Link trigger error:", err);
    return res.status(500).json({
      error: "Failed to link trigger"
    });
  }
}
async function handleUnlinkTriggerTemplate(req, res) {
  const { trigger_block_id, pm_template_id } = req.body;

  if (!trigger_block_id || !pm_template_id) {
    return res.status(400).json({
      error: "Missing trigger or template ID"
    });
  }

  try {
    await pool.query(`
      DELETE FROM trigger_block_templates
      WHERE trigger_block_id = $1
        AND pm_template_id = $2
    `, [trigger_block_id, pm_template_id]);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("Unlink trigger error:", err);
    return res.status(500).json({
      error: "Failed to unlink trigger"
    });
  }
}
  



