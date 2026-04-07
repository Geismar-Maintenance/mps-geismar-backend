export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    partid,
    from_locationid,
    cabinet,
    section,
    bin,
    qty,
    performed_by
  } = req.body;

  if (!partid || !from_locationid || !cabinet || !section || !bin || qty <= 0) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Decrement source location
    const dec = await client.query(
      `
      UPDATE partlocations
      SET qty = qty - $1
      WHERE locationid = $2
        AND partid = $3
        AND qty >= $1
      RETURNING qty
      `,
      [qty, from_locationid, partid]
    );

    if (dec.rowCount === 0) {
      throw new Error("Insufficient quantity in source location");
    }

    // 2️⃣ Increment / create destination location
    const dest = await client.query(
      `
      INSERT INTO partlocations (partid, cabinet, section, bin, qty)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (partid, cabinet, section, bin)
      DO UPDATE SET qty = partlocations.qty + EXCLUDED.qty
      RETURNING locationid
      `,
      [partid, cabinet, section, bin, qty]
    );

    const to_locationid = dest.rows[0].locationid;

    // 3️⃣ Model snapshot
    const part = await client.query(
      "SELECT model FROM masterparts WHERE partid = $1",
      [partid]
    );

    const modelSnapshot = part.rows[0]?.model || null;

    // 4️⃣ Insert TRANSFER transaction (type = 3)
    await client.query(
      `
      INSERT INTO transactions (
        partid,
        from_locationid,
        to_locationid,
        qty,
        transactiontype,
        performed_by,
        part_model_snapshot
      )
      VALUES ($1, $2, $3, $4, 3, $5, $6)
      `,
      [
        partid,
        from_locationid,
        to_locationid,
        qty,
        performed_by || null,
        modelSnapshot
      ]
    );

    await client.query("COMMIT");
    res.status(200).json({ success: true });

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });

  } finally {
    client.release();
  }
}
