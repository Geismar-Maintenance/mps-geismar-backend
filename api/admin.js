import bcrypt from "bcryptjs";

// TEMP DB LAYER (replace later)
import {
  getUserByUsername,
  updateUserPin,
  insertAudit
} from "../lib/db";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, ...data } = req.body;

  try {
    switch (action) {

      // ------------------------------------
      // CHANGE PIN
      // ------------------------------------
      case "changePin":
        return await changePin(data, res);

      // Future admin actions go here:
      // case "resetUserPin":
      // case "createUser":
      // case "disableUser":

      default:
        return res.status(400).json({ error: "Invalid action" });
    }

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
