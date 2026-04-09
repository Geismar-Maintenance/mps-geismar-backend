export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const TRANSACTION_TYPES = {
  ISSUE: 1,
  RECEIVE: 2,
  MOVE: 3
};

const RECEIVING_LOCATION_ID = 1;

export default async function handler(req, res) {
  // ✅ CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ✅ Normalize input
const partid = parseInt(req.body?.partid, 10);
const qty = parseInt(req.body?.qty, 10);
const performed_by = req.body?.performed_by ?? "system";

// ✅ Receiving is enforced here
const locationid = RECEIVING_LOCATION_ID;

if (!partid || !qty || qty <= 0) {
  return res.status(400).json({
    error: "Invalid receive data",
    debug: { partid, qty }
  });
}
``

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Upsert location inventory
    const updateRes = await client.query(
      `
      UPDATE partlocations
      SET qty = qty + $1
      WHERE locationid = $2 AND partid = $3
      RETURNING locationid, qty
      `,
      [qty, locationid, partid]
    );

    let finalQty;

    if (updateRes.rowCount === 0) {
      // Location + part combination doesn’t exist yet → create it
      const insertRes = await client.query(
        `
        INSERT INTO partlocations (partid, locationid, qty)
        VALUES ($1, $2, $3)
        RETURNING locationid, qty
        `,
        [partid, locationid, qty]
      );
      finalQty = insertRes.rows[0].qty;
    } else {
      finalQty = updateRes.rows[0].qty;
    }

    // 2️⃣ Insert transaction record
    await client.query(
      `
      INSERT INTO transactions (
        transactiontypeid,
        partid,
        to_locationid,
        qty,
        performed_by,
        transactiondate
      )
      VALUES (
        $1, $2, $3, $4, $5, NOW()
      )
      `,
      [
        TRANSACTION_TYPES.RECEIVE,
        partid,
        locationid,
        qty,
        performed_by
      ]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      locationid,
      new_qty: finalQty
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("RECEIVE FAILED:", err);
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
}
