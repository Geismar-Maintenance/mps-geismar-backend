import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { table } = req.query;

  try {
    if (table === "wotypes") {
      const r = await pool.query(
        "SELECT id, type, description FROM wotypes ORDER BY type"
      );
      return res.json(r.rows);
    }

    if (table === "wopriorities") {
      const r = await pool.query(
        "SELECT id, priority, description FROM wopriorities ORDER BY id"
      );
      return res.json(r.rows);
    }

    return res.status(400).json({ error: "Unknown lookup table" });

  } catch (err) {
    console.error("Lookup error:", err);
    return res.status(500).json({ error: "Lookup failed" });
  }
}
