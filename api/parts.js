// export const runtime = "nodejs";

// import { Pool } from "pg";
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// export default async function handler(req, res) {
module.exports = async function handler(req, res) {
  /* ==========================
     CORS
     ========================== */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  /* ======================================================
     ✅ ADMIN: CREATE MASTER PART (EXPLICIT GATE)
     POST /api/parts?admin=true
     ====================================================== */
  if (req.method === "POST" && req.query.admin === "true") {
    const {
      partnumber,
      manufacturer,
      model,
      description,
      cost,
      reorderlevel
    } = req.body;

    // ✅ Validation
    if (!partnumber || !description) {
      return res.status(400).json({
        error: "partnumber and description are required"
      });
    }

    const client = await pool.connect();

    try {
      // ✅ Enforce unique part number
      const exists = await client.query(
        `SELECT partid FROM masterparts WHERE partnumber = $1`,
        [partnumber.trim()]
      );

      if (exists.rowCount > 0) {
        return res.status(409).json({
          error: "Part number already exists"
        });
      }

      // ✅ Insert MASTER ONLY (no inventory, no locations)
      const result = await client.query(
        `
        INSERT INTO masterparts
          (partnumber, manufacturer, model, description, cost, reorderlevel)
        VALUES
          ($1, $2, $3, $4, $5, $6)
        RETURNING partid, partnumber
        `,
        [
          partnumber.trim(),
          manufacturer?.trim() || null,
          model?.trim() || null,
          description.trim(),
          Number(cost) || 0,
          Number(reorderlevel) || 0
        ]
      );

      return res.status(201).json({
        success: true,
        partid: result.rows[0].partid,
        partnumber: result.rows[0].partnumber
      });

    } catch (err) {
      console.error("ADMIN PART CREATE ERROR:", err);
      return res.status(500).json({
        error: "Failed to create master part"
      });
    } finally {
      client.release();
    }
  }

  /* ======================================================
     ❌ BLOCK ALL OTHER POSTs
     ====================================================== */
  if (req.method === "POST") {
    return res.status(405).json({
      error: "POST not allowed without admin=true"
    });
  }

  /* ======================================================
     ✅ OPS: GET HANDLERS
     ====================================================== */
  if (req.method === "GET") {
    const summary = req.query.summary;
    const search = req.query.search?.trim() || "";
/* --------------------------
     PARTS TRANSACTION HISTORY
     GET /api/parts?history=true
     -------------------------- */
  if (req.query.history === "true") {
    try {
      const result = await pool.query(`
        SELECT
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

    } catch (err) {
      console.error("ERROR loading parts history:", err);
      return res.status(500).json({
        error: "Failed to load parts history"
      });
    }
  }
    
    /* --------------------------
       DASHBOARD INVENTORY SUMMARY
       GET /api/parts?summary=inventory
       -------------------------- */
    if (summary === "inventory") {
      try {
        const result = await pool.query(`
          SELECT
            COUNT(*) FILTER (
              WHERE total_qty = 0
            ) AS out_stock,
            COUNT(*) FILTER (
              WHERE reorderlevel > 0 AND total_qty <= reorderlevel
            ) AS low_stock
          FROM (
            SELECT
              p.partid,
              COALESCE(SUM(pl.qty), 0) AS total_qty,
              p.reorderlevel AS reorderlevel
            FROM masterparts p
            LEFT JOIN partlocations pl ON p.partid = pl.partid
            GROUP BY p.partid, p.reorderlevel
          ) t;
        `);

        return res.status(200).json(result.rows[0]);
      } } catch (err) {
  console.error("INVENTORY SUMMARY ERROR:", err);
  return res.status(500).json({
    error: err.message,
    stack: err.stack
  });
}

   /* --------------------------
   PART LIST / SEARCH
   GET /api/parts
   GET /api/parts?search=...
   -------------------------- */
const client = await pool.connect();

try {
  const whereClause = search.length >= 2
    ? `
        WHERE
          p.partnumber ILIKE $1 OR
          p.model ILIKE $1 OR
          p.description ILIKE $1
      `
    : ``;

  const params = search.length >= 2
    ? [`%${search}%`]
    : [];

  const partsResult = await client.query(
    `
    SELECT
      p.partid,
      p.partnumber,
      p.manufacturer,
      p.model,
      p.description,
      p.cost,
      p.reorderlevel,
      COALESCE(SUM(pl.qty), 0)::INTEGER AS total_qty
    FROM masterparts p
    LEFT JOIN partlocations pl ON pl.partid = p.partid
    ${whereClause}
    GROUP BY p.partid
    ORDER BY p.partnumber
    LIMIT 200
    `,
    params
  );

  const locationsResult = await client.query(
    `
    SELECT
      pl.partid,
      pl.locationid,
      l.cabinet,
      l.section,
      l.bin,
      pl.qty
    FROM partlocations pl
    JOIN locations l ON l.locationid = pl.locationid
    WHERE pl.qty > 0
    `
  );

  const parts = partsResult.rows.map(p => ({
    ...p,
    locations: locationsResult.rows.filter(
      l => l.partid === p.partid
    )
  }));

  return res.status(200).json(parts);

} catch (err) {
  console.error("PART LOAD ERROR:", err);
  return res.status(500).json({
    error: "Failed to fetch parts"
  });
} finally {
  client.release();
}
  /* ======================================================
     FALLBACK
     ====================================================== */
  return res.status(405).json({
    error: "Method not allowed"
  });
}
