import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { pool } from "../db.js";

const router = express.Router();

/**
 * REGISTER
 */
router.post("/register", async (req, res) => {
  try {
    const { email, password, organizationName } = req.body;

    if (!email || !password || !organizationName) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Create organization
    const orgResult = await pool.query(
      "INSERT INTO organizations (name) VALUES ($1) RETURNING id",
      [organizationName]
    );

    const organizationId = orgResult.rows[0].id;

    // Create user
    const userResult = await pool.query(
      `INSERT INTO users (email, password, organization_id)
       VALUES ($1, $2, $3)
       RETURNING id, email`,
      [email, hashedPassword, organizationId]
    );

    const user = userResult.rows[0];

    const token = jwt.sign(
      {
        userId: user.id,
        organizationId
      },
      config.jwtSecret,
      { expiresIn: "1d" }
    );

    return res.status(201).json({ token, user });

  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});


/**
 * LOGIN
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        organizationId: user.organization_id
      },
      config.jwtSecret,
      { expiresIn: "1d" }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        organizationId: user.organization_id
      }
    });

  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
