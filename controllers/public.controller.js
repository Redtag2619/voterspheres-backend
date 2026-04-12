import { pool } from "../db/pool.js";

export async function createEnterpriseLead(req, res) {
  try {
    const {
      full_name,
      firm_name,
      email,
      phone,
      team_size,
      message,
    } = req.body || {};

    if (!full_name || !firm_name || !email || !team_size || !message) {
      return res.status(400).json({
        error: "full_name, firm_name, email, team_size, and message are required",
      });
    }

    const result = await pool.query(
      `
        INSERT INTO enterprise_leads (
          full_name,
          firm_name,
          email,
          phone,
          team_size,
          message
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          full_name,
          firm_name,
          email,
          phone,
          team_size,
          message,
          created_at
      `,
      [
        full_name,
        firm_name,
        email,
        phone || null,
        team_size,
        message,
      ]
    );

    return res.status(201).json({
      ok: true,
      lead: result.rows[0],
    });
  } catch (error) {
    console.error("createEnterpriseLead error:", error.message);
    return res.status(500).json({
      error: "Failed to submit enterprise inquiry",
    });
  }
}
