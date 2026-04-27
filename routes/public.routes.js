import express from "express";
import { pool } from "../db/pool.js";

const router = express.Router();

async function ensureEnterpriseLeadsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS enterprise_leads (
      id SERIAL PRIMARY KEY,
      full_name TEXT,
      firm_name TEXT,
      email TEXT,
      role TEXT,
      team_size TEXT DEFAULT 'Website Lead',
      notes TEXT,
      source TEXT DEFAULT 'landing_page',
      status TEXT DEFAULT 'new',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS full_name TEXT`);
  await pool.query(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS firm_name TEXT`);
  await pool.query(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS email TEXT`);
  await pool.query(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS role TEXT`);
  await pool.query(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS team_size TEXT DEFAULT 'Website Lead'`);
  await pool.query(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS notes TEXT`);
  await pool.query(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'landing_page'`);
  await pool.query(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new'`);
  await pool.query(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await pool.query(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
}

router.post("/enterprise-leads", async (req, res) => {
  try {
    await ensureEnterpriseLeadsTable();

    const {
      full_name = "",
      firm_name = "",
      email = "",
      role = "",
      notes = "",
      team_size = "",
      message = ""
    } = req.body || {};

    const finalRole = role || team_size || "Website Lead";
    const finalNotes = notes || message || "";
    const finalTeamSize = team_size || role || "Website Lead";

    if (!full_name || !firm_name || !email) {
      return res.status(400).json({
        error: "full_name, firm_name, and email are required"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO enterprise_leads (
        full_name,
        firm_name,
        email,
        role,
        team_size,
        notes,
        source,
        status,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,'landing_page','new',NOW(),NOW())
      RETURNING *
      `,
      [full_name, firm_name, email, finalRole, finalTeamSize, finalNotes]
    );

    return res.status(201).json({
      ok: true,
      lead: result.rows[0]
    });
  } catch (error) {
    console.error("Enterprise lead error:", error);
    return res.status(500).json({
      error: error.message || "Failed to submit enterprise lead"
    });
  }
});

export default router;
