export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "POST") {
  try {
    const {
      cabinet,
      section,
      bin,
      description = null,
      isreceiving = false
    } = req.body;

    if (!cabinet || !section || !bin) {
      return res.status(400).json({
        error: "cabinet, section, and bin are required"
      });
    }

    // ✅ prevent duplicates
    const existing = await pool.query(
      `
      SELECT 1 FROM locations
      WHERE cabinet = $1 AND section = $2 AND bin = $3
      `,
      [cabinet, section, bin]
    );

    if (existing.rowCount > 0) {
      return res.status(400).json({
        error: "Location already exists"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO locations (
        cabinet,
        section,
        bin,
        description,
        isreceiving,
        isactive
      )
      VALUES ($1, $2, $3, $4, $5, true)
      RETURNING *
      `,
      [cabinet, section, bin, description, isreceiving]
    );

    return res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error("ERROR creating location:", err);
    return res.status(500).json({
      error: "Failed to create location"
    });
  }
}

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

/* ======================================================
   MOVE DESTINATIONS (TO dropdown)
   ====================================================== */
if (req.query.type === "move_dest") {
  const partid = Number(req.query.partid);

  if (!Number.isInteger(partid)) {
    return res.status(400).json({ error: "Invalid partid" });
  }

  const result = await pool.query(
    `
    SELECT
      l.locationid,
      l.cabinet,
      l.section,
      l.bin,
      l.description,
      COALESCE(pl.qty, 0) AS qty,

      CASE
        -- ✅ Tier 1: this part has been here before
        WHEN EXISTS (
          SELECT 1
          FROM partlocations px
          WHERE px.locationid = l.locationid
            AND px.partid = $1
        ) THEN 0

        -- ✅ Tier 2: completely empty location
        WHEN NOT EXISTS (
          SELECT 1
          FROM partlocations px
          WHERE px.locationid = l.locationid
        ) THEN 1

        -- ✅ Tier 3: occupied by other parts
        ELSE 2
      END AS priority_tier

    FROM locations l
    LEFT JOIN partlocations pl
      ON pl.locationid = l.locationid
     AND pl.partid = $1

    WHERE l.isactive = true
      AND l.isreceiving = false

    ORDER BY
      priority_tier ASC,
      qty DESC,
      l.cabinet,
      l.section,
      length(l.bin),
      l.bin
    `,
    [partid]
  );

  return res.status(200).json(result.rows);
}
    /* ======================================================
       RECEIVING LOCATIONS
       ====================================================== */
    if (req.query.type === "receiving") {

      const result = await pool.query(`
        SELECT
          locationid,
          cabinet,
          section,
          bin,
          description
        FROM locations
        WHERE isactive = true
          AND isreceiving = true
        ORDER BY cabinet, section, bin
      `);

      return res.status(200).json(result.rows);
    }

    /* ======================================================
       DEFAULT: ALL ACTIVE LOCATIONS (ADMIN / SETUP)
       ====================================================== */
    const result = await pool.query(`
      SELECT
        locationid,
        cabinet,
        section,
        bin,
        description,
        isreceiving,
        isactive
      FROM locations
      WHERE isactive = true
      ORDER BY cabinet, section, bin
    `);

    return res.status(200).json(result.rows);

  } catch (err) {
    console.error("ERROR fetching locations:", err);
    return res.status(500).json({ error: "Failed to fetch locations" });
  }
}
