export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
    return res.status(500).json({ error: "Failed to load parts history" });
  }
}
