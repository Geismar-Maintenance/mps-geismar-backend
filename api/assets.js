export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {

  // ✅ CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {

    // ===================================
    // ✅ GET — FETCH ASSETS (UNCHANGED)
    // ===================================
  if (req.method === "GET") {

  const { action } = req.query;

  // ✅ HANDLE WEEKS REQUEST
  if (action === "weeks") {

    const client = await pool.connect();

    const result = await client.query(`
      SELECT week_id
      FROM calendar_weeks
      ORDER BY week_id DESC
      LIMIT 10
    `);

    client.release();

    return res.status(200).json(result.rows);
  }

  // ✅ DEFAULT → ASSETS
  const client = await pool.connect();

  const result = await client.query(`
    SELECT
      assetid,
      assetnumber,
      assetname
    FROM assets
    WHERE isactive = true
      AND asset_class = 'manufacturing'
    ORDER BY assetnumber
  `);

  client.release();

  return res.status(200).json(result.rows);
}

    // ===================================
    // ✅ POST — RUNTIME ENTRY
    // ===================================
    if (req.method === "POST") {

      const { action } = req.body;

      // ✅ Route by action
      if (action === "add-runtime") {
        return await handleRuntimeEntry(req, res);
      }

      return res.status(400).json({ error: "Invalid action" });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("ASSETS API ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
}


// ===================================
// ✅ RUNTIME HANDLER (ISOLATED)
// ===================================
async function handleRuntimeEntry(req, res) {

  const { asset_id, week_id, runtime_hours } = req.body;

  if (!asset_id || !week_id || !runtime_hours) {
    return res.status(400).json({
      error: "asset_id, week_id, runtime_hours required"
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      INSERT INTO asset_runtime_logs
      (asset_id, week_id, runtime_hours)
      VALUES ($1, $2, $3)
    `, [asset_id, week_id, runtime_hours]);

    await client.query(`
      UPDATE assets
      SET total_runtime = total_runtime + $1
      WHERE assetid = $2
    `, [runtime_hours, asset_id]);

    await client.query("COMMIT");

    return res.status(200).json({ success: true });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("RUNTIME ERROR:", err);

    return res.status(500).json({
      error: "Transaction failed"
    });

  } finally {
    client.release();
  }
}
