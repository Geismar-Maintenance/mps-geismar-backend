export const runtime = "nodejs";

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {

  // ✅ CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {

    // =========================
    // ✅ GET USERS
    // =========================
    if (req.method === "GET") {
      const result = await pool.query(`
        SELECT username, display_name, role, active
        FROM users
        ORDER BY display_name
      `);

      return res.status(200).json(result.rows);
    }

    // =========================
    // ✅ ONLY POST AFTER THIS
    // =========================
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { action, username, currentPin, newPin } = req.body;

    // =========================
    // ✅ CHANGE PIN (your original)
    // =========================
    if (action === "changePin") {

      const userResult = await pool.query(
        `SELECT * FROM users 
         WHERE username = $1 
         AND pin_hash = crypt($2, pin_hash)
         AND active = true`,
        [username, currentPin]
      );

      const user = userResult.rows[0];

      if (!user) {
        return res.status(401).json({ error: "Current PIN incorrect" });
      }

      await pool.query(
        `UPDATE users 
         SET pin_hash = crypt($1, gen_salt('bf'))
         WHERE username = $2`,
        [newPin, username]
      );

      return res.status(200).json({ success: true });
    }

    // =========================
    // ✅ CREATE USER
    // =========================
    if (action === "createUser") {
      const { username, display_name, pin, role } = req.body;

      await pool.query(
        `INSERT INTO users (
          username,
          display_name,
          pin_hash,
          role,
          active
        )
        VALUES (
          $1,
          $2,
          crypt($3, gen_salt('bf')),
          $4,
          true
        )`,
        [username, display_name, pin, role]
      );

      return res.status(200).json({ success: true });
    }

    // =========================
    // ✅ ENABLE / DISABLE USER
    // =========================
    if (action === "toggleUser") {
      const { username, active } = req.body;

      await pool.query(
        `UPDATE users SET active = $1 WHERE username = $2`,
        [active, username]
      );

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Invalid action" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
