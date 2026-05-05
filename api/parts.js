export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ======================================================
   HELPERS
====================================================== */

function safeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function query(text, params) {
  return pool.query(text, params);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* ======================================================
   HANDLER
====================================================== */

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    /* ==================================================
       ADMIN: CREATE PART
    ================================================== */
    if (req.method === "POST" && req.query.admin === "true") {
      return await createPart(req, res);
    }

    /* ==================================================
       IMPORT INVENTORY
    ================================================== */
    if (req.method === "POST" && req.query.action === "importInventory") {
      return await importInventory(req, res);
    }

    /* ==================================================
       GET ROUTES
    ================================================== */
    if (req.method === "GET") {
      const { partId, search, summary, inventory, history, receiving } = req.query;

    if (partId) return await getPartDetails(req, res, partId);
    if (history === "true") return await getHistory(res);
    if (summary === "inventory") return await getInventorySummary(res);
    if (receiving === "true") return await getReceivingParts(res);
    if (search) return await searchParts(res, search);

// default route = inventory
return await getInventoryFilter(res, inventory || "all");

      return res.status(200).json([]);
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("API ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

/* ======================================================
   PART DETAILS
====================================================== */

async function getPartDetails(req, res, partId) {
  const id = Number(partId);

  const part = await query(
    `SELECT partid, partnumber, description, manufacturer, model, reorderlevel
     FROM masterparts
     WHERE partid = $1`,
    [id]
  );

  if (part.rowCount === 0) {
    return res.status(404).json({ error: "Part not found" });
  }

  const locations = await query(
    `SELECT l.cabinet, l.section, l.bin, pl.qty
     FROM partlocations pl
     JOIN locations l ON l.locationid = pl.locationid
     WHERE pl.partid = $1 AND pl.qty > 0
     ORDER BY l.cabinet, l.section, l.bin`,
    [id]
  );

  const history = await query(
    `SELECT t.transactiondate, tt.transactiontype, t.qty, t.performed_by
     FROM transactions t
     JOIN transactiontypes tt ON tt.transactiontypeid = t.transactiontypeid
     WHERE t.partid = $1
     ORDER BY t.transactiondate DESC
     LIMIT 50`,
    [id]
  );

  return res.status(200).json({
    part: part.rows[0],
    locations: locations.rows,
    history: history.rows
  });
}

/* ======================================================
   SEARCH PARTS
====================================================== */

async function searchParts(res, search) {
  const q = `%${search}%`;

  const parts = await query(
    `SELECT
        p.partid,
        p.partnumber,
        p.manufacturer,
        p.model,
        p.description,
        p.cost,
        p.reorderlevel,
        COALESCE(SUM(pl.qty), 0)::int AS total_qty
     FROM masterparts p
     LEFT JOIN partlocations pl ON pl.partid = p.partid
     WHERE
        p.partnumber ILIKE $1 OR
        p.model ILIKE $1 OR
        p.description ILIKE $1
     GROUP BY p.partid
     ORDER BY p.partnumber
     LIMIT 100`,
    [q]
  );

  const locations = await query(
    `SELECT pl.partid, l.cabinet, l.section, l.bin, pl.qty
     FROM partlocations pl
     JOIN locations l ON l.locationid = pl.locationid
     WHERE pl.qty > 0`
  );

  const merged = parts.rows.map(p => ({
    ...p,
    locations: locations.rows.filter(l => l.partid === p.partid)
  }));

  return res.status(200).json(merged);
}

/* ======================================================
   INVENTORY FILTER (low / out)
====================================================== */

async function getInventoryFilter(res, type) {
  const result = await query(
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
        COALESCE(SUM(pl.qty), 0)::int AS total_qty
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
      (
        $1 = 'all'
        OR ($1 = 'out' AND total_qty = 0)
        OR ($1 = 'in' AND total_qty > 0)
        OR (
          $1 = 'low'
          AND reorderlevel > 0
          AND total_qty > 0
          AND total_qty <= reorderlevel
        )
      )
    ORDER BY partnumber
    `,
    [type]
  );

  // 👇 ADD THIS (same pattern as searchParts)
  const locations = await query(
    `
    SELECT pl.partid, l.cabinet, l.section, l.bin, pl.qty
    FROM partlocations pl
    JOIN locations l ON l.locationid = pl.locationid
    WHERE pl.qty > 0
    `
  );

  const merged = result.rows.map(p => ({
    ...p,
    locations: locations.rows.filter(l => l.partid === p.partid)
  }));

  return res.status(200).json(merged);
}
/* ======================================================
   INVENTORY FILTER (Receiving)
====================================================== */
async function getReceivingParts(res) {
  const result = await query(`
    SELECT
      p.partid,
      p.partnumber,
      p.description,
      p.manufacturer,
      p.model,
      pl.qty AS total_qty,
      l.cabinet,
      l.section,
      l.bin
    FROM partlocations pl
    JOIN locations l ON l.locationid = pl.locationid
    JOIN masterparts p ON p.partid = pl.partid
    WHERE COALESCE(l.isreceiving, false) = true
      AND pl.qty > 0
    ORDER BY p.partnumber, l.cabinet, l.section, l.bin
  `);

  async function getReceivingParts(res) {
  const result = await query(`
    SELECT
      p.partid,
      p.partnumber,
      p.description,
      p.manufacturer,
      p.model,
      pl.qty AS total_qty,
      l.cabinet,
      l.section,
      l.bin
    FROM partlocations pl
    JOIN locations l ON l.locationid = pl.locationid
    JOIN masterparts p ON p.partid = pl.partid
    WHERE COALESCE(l.isreceiving, false) = true
      AND pl.qty > 0
    ORDER BY p.partnumber, l.cabinet, l.section, l.bin
  `);

  const grouped = result.rows.reduce((acc, row) => {
    let part = acc.find(p => p.partid === row.partid);

    if (!part) {
      part = {
        partid: row.partid,
        partnumber: row.partnumber,
        description: row.description,
        manufacturer: row.manufacturer,
        model: row.model,
        total_qty: 0,
        locations: []
      };
      acc.push(part);
    }

    part.total_qty += row.total_qty;

    part.locations.push({
      cabinet: row.cabinet,
      section: row.section,
      bin: row.bin,
      qty: row.total_qty
    });

    return acc;
  }, []);

  return res.status(200).json(grouped);
}
/* ======================================================
   INVENTORY SUMMARY
====================================================== */

async function getInventorySummary(res) {
  const result = await query(
    `SELECT
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
        GROUP BY p.partid
     ) t`
  );

  return res.status(200).json(result.rows[0]);
}

/* ======================================================
   HISTORY
====================================================== */

async function getHistory(res) {
  const result = await query(
    `SELECT
        t.transactiondate,
        tt.transactiontype,
        p.partnumber,
        p.description,
        t.qty,
        t.performed_by
     FROM transactions t
     JOIN transactiontypes tt ON tt.transactiontypeid = t.transactiontypeid
     JOIN masterparts p ON p.partid = t.partid
     ORDER BY t.transactiondate DESC
     LIMIT 500`
  );

  return res.status(200).json(result.rows);
}

/* ======================================================
   CREATE PART (ADMIN)
====================================================== */

async function createPart(req, res) {
  const {
    partnumber,
    manufacturer,
    model,
    description,
    cost,
    reorderlevel
  } = req.body;

  if (!partnumber || !description) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const exists = await query(
    `SELECT 1 FROM masterparts WHERE partnumber = $1`,
    [partnumber.trim()]
  );

  if (exists.rowCount > 0) {
    return res.status(409).json({ error: "Part already exists" });
  }

  const result = await query(
    `INSERT INTO masterparts
      (partnumber, manufacturer, model, description, cost, reorderlevel)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING partid, partnumber`,
    [
      partnumber.trim(),
      manufacturer || null,
      model || null,
      description.trim(),
      safeInt(cost),
      safeInt(reorderlevel)
    ]
  );

  return res.status(201).json(result.rows[0]);
}

/* ======================================================
   IMPORT INVENTORY
====================================================== */

async function importInventory(req, res) {
  const { rows } = req.body;

  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const r of rows) {
      const qty = safeInt(r.qty);

      const part = await client.query(
        `SELECT partid FROM masterparts WHERE partnumber = $1`,
        [r.partnumber]
      );

      let partid;

      if (part.rowCount === 0) {
        const inserted = await client.query(
          `INSERT INTO masterparts
           (partnumber, description, manufacturer, model, reorderlevel, cost)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING partid`,
          [
            r.partnumber,
            r.description,
            r.manufacturer,
            r.model,
            safeInt(r.reorderlevel),
            safeInt(r.cost)
          ]
        );
        partid = inserted.rows[0].partid;
      } else {
        partid = part.rows[0].partid;
      }

      const loc = await client.query(
        `SELECT locationid FROM locations
         WHERE cabinet=$1 AND section=$2 AND bin=$3`,
        [r.cabinet, r.section, r.bin]
      );

      let locationid;

      if (loc.rowCount === 0) {
        const inserted = await client.query(
          `INSERT INTO locations (cabinet, section, bin)
           VALUES ($1,$2,$3)
           RETURNING locationid`,
          [r.cabinet, r.section, r.bin]
        );
        locationid = inserted.rows[0].locationid;
      } else {
        locationid = loc.rows[0].locationid;
      }

      await client.query(
        `INSERT INTO partlocations (partid, locationid, qty)
         VALUES ($1,$2,$3)
         ON CONFLICT (partid, locationid)
         DO UPDATE SET qty = EXCLUDED.qty`,
        [partid, locationid, qty]
      );
    }

    await client.query("COMMIT");

    return res.status(200).json({ success: true });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ error: "Import failed" });
  } finally {
    client.release();
  }
}
