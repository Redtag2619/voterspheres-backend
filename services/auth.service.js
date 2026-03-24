import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";

const SALT_ROUNDS = 10;

async function ensureAuthTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NULL,
      first_name TEXT,
      last_name TEXT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS firms (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT,
      plan_tier TEXT DEFAULT 'trial',
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

function signToken(user) {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      firm_id: user.firm_id
    },
    secret,
    { expiresIn: "7d" }
  );
}

function sanitizeUser(row) {
  return {
    id: row.id,
    firm_id: row.firm_id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    role: row.role,
    status: row.status,
    created_at: row.created_at
  };
}

export async function signup(req, res, next) {
  try {
    await ensureAuthTables();

    const {
      first_name = "",
      last_name = "",
      email,
      password,
      firm_name = "",
      role = "admin"
    } = req.body || {};

    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: "email is required" });
    }

    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: "password must be at least 8 characters" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existing = await pool.query(
      `SELECT id FROM app_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail]
    );

    if (existing.rows[0]) {
      return res.status(409).json({ error: "email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    let firmId = null;

    if (firm_name && String(firm_name).trim()) {
      const firmInsert = await pool.query(
        `
        INSERT INTO firms (name, slug, plan_tier, status, updated_at)
        VALUES ($1, NULL, 'trial', 'active', NOW())
        RETURNING *
        `,
        [String(firm_name).trim()]
      );

      firmId = firmInsert.rows[0].id;
    }

    const userInsert = await pool.query(
      `
      INSERT INTO app_users
      (firm_id, first_name, last_name, email, password_hash, role, status, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())
      RETURNING *
      `,
      [
        firmId,
        String(first_name).trim(),
        String(last_name).trim(),
        normalizedEmail,
        passwordHash,
        role
      ]
    );

    const user = sanitizeUser(userInsert.rows[0]);
    const token = signToken(user);

    res.status(201).json({
      token,
      user
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    await ensureAuthTables();

    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const result = await pool.query(
      `
      SELECT *
      FROM app_users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [normalizedEmail]
    );

    const userRow = result.rows[0];

    if (!userRow) {
      return res.status(401).json({ error: "invalid email or password" });
    }

    const valid = await bcrypt.compare(password, userRow.password_hash);

    if (!valid) {
      return res.status(401).json({ error: "invalid email or password" });
    }

    if (userRow.status !== "active") {
      return res.status(403).json({ error: "user account is not active" });
    }

    const user = sanitizeUser(userRow);
    const token = signToken(user);

    res.json({
      token,
      user
    });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    await ensureAuthTables();

    const userId = req.user?.id;

    const result = await pool.query(
      `
      SELECT *
      FROM app_users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    const userRow = result.rows[0];

    if (!userRow) {
      return res.status(404).json({ error: "user not found" });
    }

    res.json({
      user: sanitizeUser(userRow)
    });
  } catch (err) {
    next(err);
  }
}
