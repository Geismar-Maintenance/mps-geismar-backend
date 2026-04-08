export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ✅ Transaction type constants (match transactiontypes table)
const TRANSACTION_TYPES = {
  ISSUE: 1,
  RECEIVE: 2,
  MOVE: 3
};

export default async function handler(req, res) {
  // ✅ CORS HEADERS — MUST BE FIRST
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ✅ POST only
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ✅ Normalize & validate input
  const partid = Number(req.body.partid);
  const from_locationid = Number(req.body.from_locationid);
  const qty = Number(req.body.qty);
  const assetid = Number(req.body.assetid);
  const workorder = req.body.workorder ?? null;
  const performed_by = req.body.performed_by ?? "system";

  if (
    !Number.isInteger(partid) ||
    !Number.isInteger(from_locationid) ||
    !Number.isInteger(qty) ||
    !Number.isInteger(assetid) ||
    qty <= 0
  ) {
    return res.status(400).json({ error: "Invalid issue request data" });
  }

  console.log("ISSUE REQUEST BODY:", {
    partid,
    from_locationid,
    qty,
    assetid,
    workorder,
    performed_by
  });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Lock & validate inventory
    const locRes = await client.query(
      `
      SELECT qty
      FROM partlocations
      WHERE locationid = $1
      FOR UPDATE
      `,
      [from_locationid]
    );

    if (locRes.rowCount === 0) {
      throw new Error("Location not found");
    }

    if (locRes.rows[0].qty < qty) {
      throw new Error("Insufficient inventory");
    }

    // 2️⃣ Decrement inventory
    const updateRes = await client.query(
      `
      UPDATE partlocations
      SET qty = qty - $1
      WHERE locationid = $2
      RETURNING locationid, qty
      `,
      [qty, from_locationid]
    );

    if (updateRes.rowCount === 0) {
      throw new Error("Inventory update failed");
    }

    // 3️⃣ Insert transaction record
    await client.query(
      `
      INSERT INTO transactions (
        transactiontypeid,
        partid,
        from_locationid,
        qty,
        assetid,
        workorder,
        performed_by,
        transactiondate
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, NOW()
      )
      `,
      [
        TRANSACTION_TYPES.ISSUE,
        partid,
        from_locationid,
        qty,
        assetid,
        workorder,
        performed_by
      ]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      locationid: from_locationid,
      remaining_qty: updateRes.rows[0].qty
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ISSUE FAILED:", err);
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
}
