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

  /* ==========================
     AUTH ACTIONS
     ========================== */
  if (req.method === "POST" && req.query.action === "login") {
    const { username, pin } = req.body;

    if (!username || !pin) {
      return res.status(400).json({ error: "Missing credentials" });
    }

    try {
      const r = await pool.query(
        `
        SELECT userid, username, display_name, role, pin_hash
        FROM users
        WHERE username = $1 AND active = true
        `,
        [username]
      );

      if (
        r.rowCount === 0 ||
        (await pool.query(
          "SELECT crypt($1, $2) = $2 AS ok",
          [pin, r.rows[0].pin_hash]
        )).rows[0].ok !== true
      ) {
        return res.status(401).json({ error: "Invalid login" });
      }

      // Phase 1: identity only (no session yet)
      return res.status(200).json({
        userid: r.rows[0].userid,
        username: r.rows[0].username,
        display_name: r.rows[0].display_name,
        role: r.rows[0].role
      });

    } catch (err) {
      console.error("LOGIN ERROR:", err);
      return res.status(500).json({ error: "Login failed" });
    }
  }
  return res.status(405).json({ error: "Method not allowed" });
}

  /* ==========================
     LOOKUPS (GET only)
     ========================== */
  if (req.method === "GET") {
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
      console.error("LOOKUP ERROR:", err);
      return res.status(500).json({ error: "Lookup failed" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
