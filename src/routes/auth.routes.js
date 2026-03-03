import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../db.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * REGISTER
 * Creates organization + owner user
 */
router.post("/register", async (req, res) => {
  try {
    const { organizationName, email, password } = req.body;

    if (!organizationName || !email || !password) {
      return res.status(400).json({ error: "All fields required" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    // Create organization
    const orgResult = await pool.query(
      `INSERT INTO organizations (name)
       VALUES ($1)
       RETURNING *`,
      [organizationName]
    );

    const organization = orgResult.rows[0];

    // Create owner user
    const userResult = await pool.query(
      `INSERT INTO users (organization_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'owner')
       RETURNING id, email, role`,
      [organization.id, email, password_hash]
    );

    const user = userResult.rows[0];

    const token = jwt.sign(
      {
        userId: user.id,
        organizationId: organization.id,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Registration failed" });
  }
});

/**
 * LOGIN
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1`,
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        organizationId: user.organization_id,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login failed" });
  }
});

export default router;
