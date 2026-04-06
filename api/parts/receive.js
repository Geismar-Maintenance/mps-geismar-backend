export const runtime = "nodejs";

import { getPool } from "../../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { partid, cabinet, section, bin, qty, performed_by } = req.body;

  if (!partid || !cabinet || !section || !bin || !qty || qty <= 0) {
    return res.status(400).json({ error: "Invalid request data" });
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Upsert inventory
    const locResult = await client.query(
      `
      INSERT INTO partlocations (partid, cabinet, section, bin, qty)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (partid, cabinet, section, bin)
      DO UPDATE SET qty = partlocations.qty + EXCLUDED.qty
      RETURNING locationid
      `,
      [partid, cabinet, section, bin, qty]
    );

    const to_locationid = locResult.rows[0].locationid;

    // 2️⃣ Get model snapshot
    const partResult = await client.query(
      `SELECT model FROM masterparts WHERE partid = $1`,
      [partid]
    );

    const modelSnapshot = partResult.rows[0]?.model || null;

    // 3️⃣ Insert transaction
    await client.query(
      `
      INSERT INTO transactions (
        partid,
        to_locationid,
        qty,
        transactiontype,
        performed_by,
        part_model_snapshot
      )
      VALUES ($1, $2, $3, 2, $4, $5)
      `,
      [
        partid,
        to_locationid,
        qty,
        performed_by || null,
        modelSnapshot
      ]
    );

    await client.query("COMMIT");

    return res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
}
