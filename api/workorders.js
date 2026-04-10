const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method === "GET") {
      const result = await pool.query(`
        SELECT
          w.woid,
          a.assetname,
          w.description,
          wt.type AS type,
          p.priority AS priority,
          s.status AS status,
          w.duedate
        FROM workorders w
        LEFT JOIN assets a ON a.assetid = w.assetid
        LEFT JOIN wotypes wt ON wt.id = w.wotype
        LEFT JOIN wopriorities p ON p.id = w.priority
        LEFT JOIN wostatus s ON s.id = w.status
        ORDER BY w.opendate DESC
      `);

      return res.status(200).json(result.rows);
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("Workorders API failed:", err);
    return res.status(500).json({ error: err.message });
  }
};
