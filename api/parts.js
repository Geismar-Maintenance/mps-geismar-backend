
export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  // ✅ CORS HEADERS — MUST BE FIRST
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ✅ Allow GET only
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ✅ search logic continues below


  const {
    partid,
    from_locationid,
    qty,
    assetid,
    workorder,
    performed_by
  } = req.body;

  if (!partid || !from_locationid || !qty || !assetid) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Validate available quantity
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

    const availableQty = locRes.rows[0].qty;
    if (availableQty < qty) {
      throw new Error("Insufficient inventory");
    }

    // 2️⃣ Decrement inventory
    await client.query(
      `
      UPDATE partlocations
      SET qty = qty - $1
      WHERE locationid = $2
      `,
      [qty, from_locationid]
    );

    // 3️⃣ Insert transaction record
    await client.query(
      `
      INSERT INTO transactions (
        transactiontype,
        partid,
        from_locationid,
        qty,
        assetid,
        workorder,
        performed_by,
        transactiondate
      )
      VALUES (
        'ISSUE',
        $1, $2, $3, $4, $5, $6, NOW()
      )
      `,
      [
        partid,
        from_locationid,
        qty,
        assetid,
        workorder,
        performed_by
      ]
    );

    await client.query("COMMIT");

    res.status(200).json({ success: true });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Issue failed:", err);
    res.status(400).json({ error: err.message });

  } finally {
    client.release();
  }
}
