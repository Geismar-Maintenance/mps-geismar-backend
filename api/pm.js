export const runtime = "nodejs";

export default async function handler(req, res) {
  /* ==========================
     CORS — ALWAYS FIRST
     ========================== */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // ✅ Safe URL parsing (no host dependency)
    const action = new URL(req.url, "http://localhost")
      .searchParams
      .get("action");

    /* ======================================================
       POST /api/pm?action=run
       ====================================================== */
    if (req.method === "POST" && action === "run") {
      return res.status(200).json({
        success: true,
        message: "PM engine run routing OK"
      });
    }

    return res.status(405).json({
      error: "Method not allowed"
    });

  } catch (err) {
    console.error("PM ROUTING ERROR:", err);

    // ✅ Even errors return CORS headers
    return res.status(500).json({
      error: "PM routing failure"
    });
  }
}
