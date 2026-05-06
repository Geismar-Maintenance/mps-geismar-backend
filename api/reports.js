const express = require("express");
const router = express.Router();
const pool = require("./db"); // ✅ adjust if your pool import is different

/* ======================================================
   INVENTORY REPORTS
   ====================================================== */

// ✅ Inventory by Cabinet / Section
router.get("/inventory-section", async (req, res) => {
  const { cabinet, section } = req.query;

  if (!cabinet || !section) {
    return res.status(400).json({
      error: "cabinet and section required"
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        p.partid,
        p.partnumber,
        p.description,
        l.cabinet,
        l.section,
        l.bin,
        pl.qty
      FROM partlocations pl
      JOIN parts p ON p.partid = pl.partid
      JOIN locations l ON l.locationid = pl.locationid
      WHERE UPPER(l.cabinet) = UPPER($1)
        AND UPPER(l.section) = UPPER($2)
      ORDER BY l.bin, p.partnumber
      `,
      [cabinet, section]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("inventory-section report failed:", err);
    res.status(500).json({ error: "Failed to load report" });
  }
});

module.exports = router;
``
