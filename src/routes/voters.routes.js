import express from "express";
import { pool } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { requireTenant } from "../middleware/tenant.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Get All Voters (Tenant Scoped)
|--------------------------------------------------------------------------
*/
router.get("/", authenticate, requireTenant, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM voters WHERE organization_id = $1",
      [req.organizationId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch voters error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/*
|--------------------------------------------------------------------------
| Create Voter (Tenant Scoped)
|--------------------------------------------------------------------------
*/
router.post("/", authenticate, requireTenant, async (req, res) => {
  try {
    const { name, email } = req.body;

    const result = await pool.query(
      `INSERT INTO voters (name, email, organization_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, email, req.organizationId]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create voter error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
