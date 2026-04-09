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

  const partid = parseInt(req.body?.partid, 10);
  const from_locationid = parseInt(req.body?.from_locationid, 10);
  const to_locationid = parseInt(req.body?.to_locationid, 10);
  const qty = parseInt(req.body?.qty, 10);
  const performed_by = req.body?.performed_by ?? "system";

  if (
    !partid ||
    !from_locationid ||
    !to_locationid ||
    !qty ||
    qty <= 0 ||
    from_locationid === to_locationid
  ) {
    return res.status(400).json({ error: "Invalid move data" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Lock & validate source inventory
    const source = await client.query(
      `
      SELECT qty
      FROM partlocations
      WHERE partid = $1 AND locationid = $2
      FOR UPDATE
      `,
      [partid, from_locationid]
    );

    if (source.rowCount === 0 || source.rows[0].qty < qty) {
      throw new Error("Insufficient inventory at source location");
    }

    // 2️⃣ Decrement source
    await client.query(
      `
      UPDATE partlocations
      SET qty = qty - $1
      WHERE partid = $2 AND locationid = $3
      `,
      [qty, partid, from_locationid]
    );

    // 3️⃣ Increment destination (upsert)
    const dest = await client.query(
      `
      UPDATE partlocations
      SET qty = qty + $1
      WHERE partid = $2 AND locationid = $3
      RETURNING qty
      `,
      [qty, partid, to_locationid]
    );

    if (dest.rowCount === 0) {
      await client.query(
        `
        INSERT INTO partlocations (partid, locationid, qty)
        VALUES ($1, $2, $3)
        `,
        [partid, to_locationid, qty]
      );
    }

    // 4️⃣ Record transaction
    await client.query(
      `
      INSERT INTO transactions (
        transactiontypeid,
        partid,
        from_locationid,
        to_locationid,
