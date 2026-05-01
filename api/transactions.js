export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ✅ Transaction types (single source of truth)
const TRANSACTION_TYPES = {
  ISSUE: 1,
  RECEIVE: 2,
  MOVE: 3
};

const RECEIVING_LOCATION_ID = 1;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // ✅ GET — transaction history (UNCHANGED)
    if (req.method === "GET") {
      const result = await pool.query(`
        SELECT
          t.transactionid,
          t.transactiondate,
          tt.transactiontype,
          p.partnumber,
          p.description,
          t.qty,
          t.performed_by,

          lf.cabinet AS from_cabinet,
          lf.section AS from_section,
          lf.bin AS from_bin,

          lt.cabinet AS to_cabinet,
          lt.section AS to_section,
          lt.bin AS to_bin

        FROM transactions t
        JOIN transactiontypes tt
          ON tt.transactiontypeid = t.transactiontypeid
        JOIN masterparts p
          ON p.partid = t.partid

        LEFT JOIN locations lf
          ON lf.locationid = t.from_locationid
        LEFT JOIN locations lt
          ON lt.locationid = t.to_locationid

        ORDER BY t.transactiondate DESC
        LIMIT 500
      `);

      return res.status(200).json(result.rows);
    }

    // ✅ POST — route to correct handler
    if (req.method === "POST") {
      const { type } = req.body;

      switch (type) {
        case "issue":
          return await handleIssue(req, res);

        case "move":
          return await handleMove(req, res);

        case "receive":
          return await handleReceive(req, res);

        default:
          return res.status(400).json({ error: "Invalid transaction type" });
      }
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("Transactions API error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

/* =========================================================
   ISSUE
========================================================= */
async function handleIssue(req, res) {
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
    qty <= 0
  ) {
    return res.status(400).json({ error: "Invalid issue request data" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ✅ FIXED: include partid in lookup
    const locRes = await client.query(
      `
      SELECT qty
      FROM partlocations
      WHERE partid = $1 AND locationid = $2
      FOR UPDATE
      `,
      [partid, from_locationid]
    );

    if (locRes.rowCount === 0) {
      throw new Error("Location/part not found");
    }

    if (locRes.rows[0].qty < qty) {
      throw new Error("Insufficient inventory");
    }

    const updateRes = await client.query(
      `
      UPDATE partlocations
      SET qty = qty - $1
      WHERE partid = $2 AND locationid = $3
      RETURNING qty
      `,
      [qty, partid, from_locationid]
    );

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
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      `,
      [
        TRANSACTION_TYPES.ISSUE,
        partid,
        from_locationid,
        qty,
        assetid || null,
        workorder,
        performed_by
      ]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
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

/* =========================================================
   MOVE
========================================================= */
async function handleMove(req, res) {
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

    await client.query(
      `
      UPDATE partlocations
      SET qty = qty - $1
      WHERE partid = $2 AND locationid = $3
      `,
      [qty, partid, from_locationid]
    );

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

    await client.query(
      `
      INSERT INTO transactions (
        transactiontypeid,
        partid,
        from_locationid,
        to_locationid,
        qty,
        performed_by,
        transactiondate
      )
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      `,
      [
        TRANSACTION_TYPES.MOVE,
        partid,
        from_locationid,
        to_locationid,
        qty,
        performed_by
      ]
    );

    await client.query("COMMIT");

    return res.status(200).json({ success: true });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("MOVE FAILED:", err);
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
}

/* =========================================================
   RECEIVE
========================================================= */
async function handleReceive(req, res) {
  const partid = parseInt(req.body?.partid, 10);
  const qty = parseInt(req.body?.qty, 10);
  const performed_by = req.body?.performed_by ?? "system";

  const locationid = RECEIVING_LOCATION_ID;

  if (!partid || !qty || qty <= 0) {
    return res.status(400).json({ error: "Invalid receive data" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const updateRes = await client.query(
      `
      UPDATE partlocations
      SET qty = qty + $1
      WHERE locationid = $2 AND partid = $3
      RETURNING qty
      `,
      [qty, locationid, partid]
    );

    let finalQty;

    if (updateRes.rowCount === 0) {
      const insertRes = await client.query(
        `
        INSERT INTO partlocations (partid, locationid, qty)
        VALUES ($1,$2,$3)
        RETURNING qty
        `,
        [partid, locationid, qty]
      );
      finalQty = insertRes.rows[0].qty;
    } else {
      finalQty = updateRes.rows[0].qty;
    }

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
      VALUES ($1,$2,$3,$4,$5,NOW())
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
