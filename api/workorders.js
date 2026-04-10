export const runtime = "nodejs";

import pool from "../lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ✅ GET – list work orders
 const result = await pool.query(`
  SELECT
    w.woid,
    a.assetname,
    w.description,
    wt.type         AS type,
    p.priority      AS priority,
    s.status        AS status,
    w.duedate
  FROM workorders w
  LEFT JOIN assets a
    ON a.assetid = w.assetid
  LEFT JOIN wotypes wt
    ON wt.id = w.wotype
  LEFT JOIN wopriorities p
    ON p.id = w.priority
  LEFT JOIN wostatus s
    ON s.id = w.status
  ORDER BY w.opendate DESC
`);

      return res.status(200).json(result.rows);
    } catch (err) {
      console.error("Error loading work orders:", err);
      return res.status(500).json({ error: "Failed to load work orders" });
    }
  }

  // ✅ POST – create work order
  if (req.method === "POST") {
    const { assetid, description, wotype, priority, duedate } = req.body;

    if (!assetid || !description || !wotype || !priority) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const result = await pool.query(
        `
        INSERT INTO workorders
          (assetid, description, wotype, priority, status, duedate)
        VALUES
          ($1, $2, $3, $4, 1, $5)
        RETURNING woid
        `,
        [assetid, description, wotype, priority, duedate || null]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Error creating work order:", err);
      return res.status(500).json({ error: "Failed to create work order" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
