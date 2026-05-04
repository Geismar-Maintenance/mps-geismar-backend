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

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, username, currentPin, newPin } = req.body;

  try {

    if (action === "changePin") {

      // ---------------------------
      // VERIFY USER + PIN (SQL HANDLES HASH)
      // ---------------------------
      const userCheck = await pool.query(
        `SELECT * FROM users 
         WHERE username = $1 
         AND pin_hash = crypt($2, pin_hash)`,
        [username, currentPin]
      );

      if (userCheck.rows.length === 0) {
        return res.status(401).json({ error: "Current PIN incorrect" });
      }

      const user = userCheck.rows[0];

      // ---------------------------
      // UPDATE NEW PIN (HASHED IN DB)
      // ---------------------------
      await pool.query(
        `UPDATE users 
         SET pin_hash = crypt($1, gen_salt('bf')) 
         WHERE id = $2`,
        [newPin, user.id]
      );

      // Audit log
      await pool.query(
        `INSERT INTO audit_log (user_id, action, timestamp)
         VALUES ($1, $2, NOW())`,
        [user.id, "PIN_CHANGE"]
      );

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Invalid action" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
