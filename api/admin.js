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
      // ---------------------------
      // UPDATE NEW PIN (HASHED IN DB)
      // ---------------------------
     await pool.query(
  `UPDATE users 
   SET pin_hash = crypt($1, gen_salt('bf'))
   WHERE username = $2`,
  [newPin, username]
);

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Invalid action" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
