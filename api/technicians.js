import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  // ✅ CORS (required for GitHub Pages → Vercel)
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
        id,
        TRIM(firstname || ' ' || lastname) AS name,
        initials,
        skilllevel
      FROM technicians
      ORDER BY lastname, firstname
    `);

    return res.status(200).json(result.rows);

  } catch (err) {
    console.error("Technicians API error:", err);
    return res.status(500).json({
      error: err.message
    });
  }
}
