import pool from '../../lib/db.js'; // adjust path if needed

export default async function handler(req, res) {

  const { type } = req.query;

  try {

    // ============================
    // INVENTORY SECTION REPORT
    // ============================
    if (type === 'inventory-section') {

      const { cabinet, section } = req.query;

      if (!cabinet || !section) {
        return res.status(400).json({
          error: "cabinet and section required"
        });
      }

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

      return res.status(200).json(result.rows);
    }

    // ============================
    // UNKNOWN REPORT
    // ============================
    return res.status(400).json({
      error: "Invalid report type"
    });

  } catch (err) {
    console.error("Report error:", err);
    return res.status(500).json({
      error: "Server error"
    });
  }
}
