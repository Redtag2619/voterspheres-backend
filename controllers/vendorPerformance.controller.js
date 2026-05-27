import {
  ensureVendorPerformanceTables,
  generateVendorPerformanceScores
} from "../services/vendorPerformance.service.js";

import { pool } from "../db/pool.js";

export async function getVendorPerformance(req, res) {
  try {
    await ensureVendorPerformanceTables();
    await generateVendorPerformanceScores();

    const result = await pool.query(`
      SELECT *
      FROM vendor_performance
      ORDER BY overall_score DESC
      LIMIT 100
    `);

    res.json({
      ok: true,
      results: result.rows
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || "Failed vendor performance"
    });
  }
}
