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

  const { type } = req.query;

  try {
    if (type === "wotypes") {
      const r = await pool.query(
        "SELECT id, type, description FROM wotypes ORDER BY type"
      );
      return res.status(200).json(r.rows);
    }

    if (type === "wopriorities") {
      const r = await pool.query(
        "SELECT id, priority, description FROM wopriorities ORDER BY id"
      );
      return res.status(200).json(r.rows);
    }

    return res.status(400).json({ error: "Unknown lookup type" });

  } catch (err) {
    console.error("Lookup error:", err);
    return res.status(500).json({ error: "Lookup failed" });
  }
}
