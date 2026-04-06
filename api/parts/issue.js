export const runtime = "nodejs";

import { Pool } from "pg";

/* ---------------------------------------------------------
   Database connection
--------------------------------------------------------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ---------------------------------------------------------
   POST /api/parts/issue
--------------------------------------------------------- */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    partid,
    from_locationid,
    qty,
    assetid,
    performed_by
  } = req.body;

  /* -------- Basic validation -------- */
  if (
    !partid ||
    !from_locationid ||
    !qty ||
    qty <= 0
  ) {
    return res.status(400).json({ error: "Invalid request data" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* -------- Atomically decrement inventory -------- */
    const updateResult = await client.query(
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

    if (updateResult.rowCount === 0) {
      throw new Error("Insufficient quantity in selected location");
    }

    /* -------- Get model snapshot for transaction -------- */
    const partResult = await client.query(
      `SELECT model FROM masterparts WHERE partid = $1`,
      [partid]
    );

    const modelSnapshot =
      partResult.rows.length > 0
        ? partResult.rows[0].model
        : null;

    /* -------- Insert transaction record -------- */
    await client.query(
      `
      INSERT INTO transactions (
        partid,
        from_locationid,
        qty,
        transactiontype,
        assetid,
        performed_by,
        part_model_snapshot
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        partid,
        from_locationid,
        qty,
        1,              -- 1 = ISSUE (from transactiontypes)
        assetid || null,
        performed_by || null,
        modelSnapshot
      ]
    );

    await client.query("COMMIT");

    return res.status(200).json({ success: true });

  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: err.message });

  } finally {
    client.release();
  }
}
