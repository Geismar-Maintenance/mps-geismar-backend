import bcrypt from "bcryptjs";
import {
  getUserByUsername,
  updateUserPin,
  insertAudit
} from "../lib/db";

/**
 * MAIN HANDLER (Vercel Serverless Function)
 */
export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, ...data } = req.body;

  try {
    switch (action) {

      // -----------------------------------
      // CHANGE USER PIN
      // -----------------------------------
      case "changePin":
        return await changePin(data, res);

      // -----------------------------------
      // FUTURE ADMIN ACTIONS
      // -----------------------------------
      // case "createUser":
      //   return await createUser(data, res);

      // case "resetPin":
      //   return await resetPin(data, res);

      // case "disableUser":
      //   return await disableUser(data, res);

      default:
        return res.status(400).json({ error: "Invalid action" });
    }

  } catch (err) {
    console.error("ADMIN API ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

/**
 * -----------------------------------
 * CHANGE PIN FUNCTION
 * -----------------------------------
 */
async function changePin(data, res) {
  const { username, currentPin, newPin } = data;

  // ---------------------------
  // VALIDATION
  // ---------------------------
  if (!username || !currentPin || !newPin) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (!/^[0-9]{4}$/.test(newPin)) {
    return res.status(400).json({ error: "PIN must be exactly 4 digits" });
  }

  if (currentPin === newPin) {
    return res.status(400).json({ error: "New PIN must differ from current PIN" });
  }

  // ---------------------------
  // FETCH USER
  // ---------------------------
  const user = await getUserByUsername(username);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // ---------------------------
  // VERIFY CURRENT PIN
  // ---------------------------
  const isValid = await bcrypt.compare(currentPin, user.pin_hash);

  if (!isValid) {
    return res.status(401).json({ error: "Current PIN incorrect" });
  }

  // ---------------------------
  // HASH NEW PIN
  // ---------------------------
  const newHash = await bcrypt.hash(newPin, 10);

  // ---------------------------
  // UPDATE DATABASE
  // ---------------------------
  await updateUserPin(user.id, newHash);

  // ---------------------------
  // AUDIT LOG (CMMS BEST PRACTICE)
  // ---------------------------
  await insertAudit({
    userId: user.id,
    action: "PIN_CHANGE",
    timestamp: new Date()
  });

  return res.status(200).json({ success: true });
}
