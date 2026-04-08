export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  // ✅ CORS
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
    const client = await pool.connect();

    const result = await client.query(`
      SELECT
        t.transactionid,
        t.transactiontype,
        t.qty,
        t.transactiondate,
        t.performed_by,

        p.partid,
        p.partnumber,
        p.model,

        a.assetid,
        a.assettag,

        t.workorder

      FROM transactions t
      JOIN masterparts p ON p.partid = t.partid
      LEFT JOIN assets a ON a.assetid = t.assetid

      ORDER BY t.transactiondate DESC
      LIMIT 500
    `);

    client.release();

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Failed to fetch transactions:", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
}
