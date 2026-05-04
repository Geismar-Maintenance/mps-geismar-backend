export const runtime = "nodejs";

import bcrypt from "bcryptjs";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {

  // ------------------------------------
  // CORS (MUST SUPPORT GET + POST + OPTIONS)
  // ------------------------------------
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {

    // ====================================
    // GET REQUESTS (READ DATA)
    // ====================================
    if (req.method === "GET") {

      const { action, username } = req.query;

      // Example: fetch user info
      if (action === "getUser") {

        const result = await pool.query(
          "SELECT id, username FROM users WHERE username = $1",
          [username]
        );

        return res.status(200).json(result.rows[0] || null);
      }

      return res.status(400).json({ error: "Invalid GET action" });
    }

    // ====================================
    // POST REQUESTS (WRITE / ACTIONS)
    // ====================================
    if (req.method === "POST") {

      const { action, username, currentPin, newPin } = req.body;

      // ------------------------------------
      // CHANGE PIN
      // ------------------------------------
      if (action === "changePin") {

        if (!username || !currentPin || !newPin) {
          return res.status(400).json({ error: "Missing fields" });
        }

        if (!/^[0-9]{4}$/.test(newPin)) {
          return res.status(400).json({ error: "PIN must be 4 digits" });
        }

        const userResult = await pool.query(
          "SELECT * FROM users WHERE username = $1",
          [username]
        );

        const user = userResult.rows[0];

        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        const valid = await bcrypt.compare(currentPin, user.pin_hash);

        if (!valid) {
          return res.status(401).json({ error: "Current PIN incorrect" });
        }

        const hash = await bcrypt.hash(newPin, 10);

        await pool.query(
          "UPDATE users SET pin_hash = $1 WHERE id = $2",
          [hash, user.id]
        );

        await pool.query(
          "INSERT INTO audit_log (user_id, action, timestamp) VALUES ($1, $2, NOW())",
          [user.id, "PIN_CHANGE"]
        );

        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: "Invalid POST action" });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
