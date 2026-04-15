export const runtime = "nodejs";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  // ✅ 1. Update CORS to allow POST
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  /* ======================================================
     ✅ HANDLE POST: ONBOARD NEW PART
     ====================================================== */
  if (req.method === "POST") {
    const client = await pool.connect();
    try {
      const { 
        partnumber, manufacturer, model, description, 
        cost, reorderlevel, qty, cabinet, section, bin 
      } = req.body;

      await client.query("BEGIN"); // Start transaction

      // A. Insert into masterparts
      const partInsert = await client.query(
        `INSERT INTO masterparts (partnumber, manufacturer, model, description, cost, reorderlevel)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING partid`,
        [partnumber, manufacturer, model, description, cost, reorderlevel]
      );
      const newPartId = partInsert.rows[0].partid;

      // B. Find or Insert Location (Assumes a 'locations' table exists)
      // Note: You might need to adjust this depending on if you want to create 
      // new locations on the fly or select existing IDs.
      let locResult = await client.query(
        `SELECT locationid FROM locations WHERE cabinet=$1 AND section=$2 AND bin=$3`,
        [cabinet, section, bin]
      );

      let locationId;
      if (locResult.rows.length > 0) {
        locationId = locResult.rows[0].locationid;
      } else {
        const newLoc = await client.query(
          `INSERT INTO locations (cabinet, section, bin) VALUES ($1, $2, $3) RETURNING locationid`,
          [cabinet, section, bin]
        );
        locationId = newLoc.rows[0].locationid;
      }

      // C. Link Part to Location with initial quantity
      await client.query(
        `INSERT INTO partlocations (partid, locationid, qty) VALUES ($1, $2, $3)`,
        [newPartId, locationId, qty]
      );

      await client.query("COMMIT");
      return res.status(201).json({ success: true, message: `Part ${partnumber} onboarded.` });

    } catch (err) {
      await client.query("ROLLBACK");
      console.error("POST ERROR:", err);
      return res.status(500).json({ error: "Onboarding failed: " + err.message });
    } finally {
      client.release();
    }
  }

  /* ======================================================
     ✅ HANDLE GET: SUMMARY & SEARCH
     ====================================================== */
  if (req.method === "GET") {
    const summary = req.query.summary;
    const search = req.query.search?.trim() || "";

    // --- DASHBOARD SUMMARY ---
    if (summary === "inventory") {
      try {
        const result = await pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE total_qty = 0) AS out_stock,
            COUNT(*) FILTER (WHERE reorderlevel > 0 AND total_qty <= reorderlevel) AS low_stock
          FROM (
            SELECT p.partid, COALESCE(SUM(pl.qty), 0) AS total_qty, p.reorderlevel
            FROM masterparts p
            LEFT JOIN partlocations pl ON p.partid = pl.partid
            GROUP BY p.partid
          ) t;
        `);
        return res.status(200).json(result.rows[0]);
      } catch (err) {
        return res.status(500).json({ error: "Summary failed" });
      }
    }

    // --- SEARCH ---
    if (search.length < 2) return res.status(200).json([]);

    let client;
    try {
      client = await pool.connect();
      const partsResult = await client.query(
        `SELECT p.*, COALESCE(SUM(pl.qty), 0)::INTEGER AS total_qty
         FROM masterparts p
         LEFT JOIN partlocations pl ON pl.partid = p.partid
         WHERE p.partnumber ILIKE $1 OR p.model ILIKE $1 OR p.description ILIKE $1
         GROUP BY p.partid ORDER BY p.partnumber LIMIT 100`,
        [`%${search}%`]
      );

      const locationsResult = await client.query(
        `SELECT pl.partid, l.cabinet, l.section, l.bin, pl.qty
         FROM partlocations pl
         JOIN locations l ON l.locationid = pl.locationid`
      );

      const parts = partsResult.rows.map(p => ({
        ...p,
        locations: locationsResult.rows.filter(l => l.partid === p.partid)
      }));

      return res.status(200).json(parts);
    } catch (err) {
      return res.status(500).json({ error: "Search failed" });
    } finally {
      if (client) client.release();
    }
  }

  // Final fallback
  return res.status(405).json({ error: "Method not allowed" });
}
