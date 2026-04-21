export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
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
     ADMIN: CREATE MASTER PART
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

    if (!partnumber || !description) {
      return res.status(400).json({
        error: "partnumber and description are required"
      });
    }

    const client = await pool.connect();

    try {
      const exists = await client.query(
        `SELECT partid FROM masterparts WHERE partnumber = $1`,
        [partnumber.trim()]
      );

      if (exists.rowCount > 0) {
        return res.status(409).json({
          error: "Part number already exists"
        });
      }

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
          manufacturer || null,
          model || null,
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
     BLOCK OTHER POSTs
     ====================================================== */
  if (req.method === "POST") {
    return res.status(405).json({
      error: "POST not allowed"
    });
  }

  /* ======================================================
     GET HANDLERS
     ====================================================== */
  if (req.method === "GET") {
    const search = req.query.search?.trim() || "";
    const summary = req.query.summary;

    // GET single part details
if (req.method === "GET" && req.query.partId) {
  const partId = Number(req.query.partId);

  // 1️⃣ Part header
  const partRes = await pool.query(`
    SELECT
      partid,
      partnumber,
      description,
      manufacturer,
      model,
      reorderlevel
    FROM masterparts
    WHERE partid = $1
  `, [partId]);

  if (partRes.rowCount === 0) {
    return res.status(404).json({ error: "Part not found" });
  }

  // 2️⃣ Locations
  const locRes = await pool.query(`
    SELECT
      l.cabinet,
      l.section,
      l.bin,
      pl.qty
    FROM partlocations pl
    JOIN locations l
      ON l.locationid = pl.locationid
    WHERE pl.partid = $1
      AND pl.qty > 0
    ORDER BY l.cabinet, l.section, l.bin
  `, [partId]);

  // 3️⃣ History
  const histRes = await pool.query(`
    SELECT
      t.transactiondate,
      tt.transactiontype,
      t.qty,
      t.performed_by
    FROM transactions t
    JOIN transactiontypes tt
      ON tt.transactiontypeid = t.transactiontypeid
    WHERE t.partid = $1
    ORDER BY t.transactiondate DESC
    LIMIT 50
  `, [partId]);

  return res.status(200).json({
    part: partRes.rows[0],
    locations: locRes.rows,
    history: histRes.rows
  });
}

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
            t.performed_by
          FROM transactions t
          JOIN transactiontypes tt
            ON tt.transactiontypeid = t.transactiontypeid
          JOIN masterparts p
            ON p.partid = t.partid
          ORDER BY t.transactiondate DESC
          LIMIT 500
        `);

        return res.status(200).json(result.rows);

      } catch (err) {
        console.error("HISTORY ERROR:", err);
        return res.status(500).json({
          error: "Failed to load parts history"
        });
      }
    }

    /* --------------------------
       INVENTORY SUMMARY
       GET /api/parts?summary=inventory
       -------------------------- */
    if (summary === "inventory") {
      try {
        const result = await pool.query(`
         SELECT
  COUNT(*) FILTER (WHERE total_qty = 0) AS out_stock,
  COUNT(*) FILTER (
    WHERE reorderlevel > 0
      AND total_qty > 0
      AND total_qty <= reorderlevel
  ) AS low_stock
FROM (
  SELECT
    p.partid,
    p.reorderlevel,
    COALESCE(SUM(pl.qty), 0) AS total_qty
  FROM masterparts p
  LEFT JOIN partlocations pl ON p.partid = pl.partid
  GROUP BY p.partid, p.reorderlevel
) t;
        `);

        return res.status(200).json(result.rows[0]);

      } catch (err) {
        console.error("SUMMARY ERROR:", err);
        return res.status(500).json({
          error: "Inventory summary failed"
        });
      }
    }

/* --------------------------
   INVENTORY FILTERED LISTS
   GET /api/parts?inventory=low|out
   -------------------------- */
if (req.query.inventory) {
  const type = req.query.inventory;

  try {
    const result = await pool.query(
      `
      WITH inventory AS (
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
        LEFT JOIN partlocations pl ON p.partid = pl.partid
        GROUP BY
          p.partid,
          p.partnumber,
          p.manufacturer,
          p.model,
          p.description,
          p.cost,
          p.reorderlevel
      )
      SELECT *
      FROM inventory
      WHERE
        CASE
          WHEN $1 = 'out' THEN total_qty = 0
          WHEN $1 = 'low' THEN
            reorderlevel > 0
            AND total_qty > 0
            AND total_qty <= reorderlevel
        END
      ORDER BY partnumber
      `,
      [type]   // ✅ THIS WAS MISSING
    );

    return res.status(200).json(result.rows);

  } catch (err) {
    console.error("INVENTORY FILTER ERROR:", err);
    return res.status(500).json({
      error: "Failed to load inventory filter"
    });
  }
}

    /* --------------------------
       PART SEARCH (ORIGINAL)
       GET /api/parts?search=...
       -------------------------- */
    if (search.length < 2) {
      return res.status(200).json([]);
    }

    const client = await pool.connect();

    try {
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
        WHERE
          p.partnumber ILIKE $1 OR
          p.model ILIKE $1 OR
          p.description ILIKE $1
        GROUP BY
          p.partid,
          p.partnumber,
          p.manufacturer,
          p.model,
          p.description,
          p.cost,
          p.reorderlevel
        ORDER BY p.partnumber
        LIMIT 100
        `,
        [`%${search}%`]
      );

      const locationsResult = await client.query(`
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
      `);

      const parts = partsResult.rows.map(p => ({
        ...p,
        locations: locationsResult.rows.filter(
          l => l.partid === p.partid
        )
      }));

      return res.status(200).json(parts);

    } catch (err) {
      console.error("SEARCH ERROR:", err);
      return res.status(500).json({
        error: "Failed to fetch parts"
      });
    } finally {
      client.release();
    }
  }

  return res.status(405).json({
    error: "Method not allowed"
  });
}
