import express from "express";
import bcrypt from "bcryptjs";
import { requireFirmAdmin } from "../middleware/firmAuth.middleware.js";

const router = express.Router();

let cachedDb = null;
let cachedDbSource = null;

async function getDb() {
  if (cachedDb) {
    return { db: cachedDb, source: cachedDbSource };
  }

  const candidates = [
    "../config/database.js",
    "../config/db.js",
    "../db.js",
    "../database.js",
    "../lib/database.js",
    "../lib/db.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      const db = mod.default || mod.db || mod.pool || mod.client || null;

      if (db) {
        cachedDb = db;
        cachedDbSource = path;
        return { db, source: path };
      }
    } catch {
      // try next
    }
  }

  return { db: null, source: null };
}

async function safeQuery(sql, params = []) {
  const { db, source } = await getDb();

  if (!db) {
    throw new Error(
      "Database connection not available. Firm users route could not resolve your DB module."
    );
  }

  if (typeof db.query === "function") {
    const result = await db.query(sql, params);
    return { ...result, _dbSource: source };
  }

  if (typeof db.execute === "function") {
    const [rows] = await db.execute(sql, params);
    return { rows, _dbSource: source };
  }

  throw new Error(`Unsupported DB driver from source: ${source}`);
}

async function getFirmAdminUser(userId) {
  const result = await safeQuery(
    `
      SELECT id, first_name, last_name, email, role, firm_id, is_active
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  return result.rows?.[0] || null;
}

router.use(requireFirmAdmin);

router.get("/", async (req, res) => {
  try {
    const adminUser = await getFirmAdminUser(req.authUser.id);

    if (!adminUser) {
      return res.status(404).json({ error: "Admin user not found" });
    }

    const result = await safeQuery(
      `
        SELECT
          id,
          first_name,
          last_name,
          email,
          role,
          firm_id,
          is_active,
          invited_by_user_id,
          created_at
        FROM users
        WHERE firm_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [adminUser.firm_id]
    );

    return res.json({
      results: result.rows || []
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load firm users"
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const adminUser = await getFirmAdminUser(req.authUser.id);

    if (!adminUser) {
      return res.status(404).json({ error: "Admin user not found" });
    }

    const {
      first_name,
      last_name,
      email,
      password,
      role = "user"
    } = req.body || {};

    if (!first_name || !last_name || !email || !password) {
      return res.status(400).json({
        error: "First name, last name, email, and password are required"
      });
    }

    const allowedRoles = ["admin", "strategist", "analyst", "mailops", "user"];
    const normalizedRole = String(role || "user").toLowerCase();

    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const existing = await safeQuery(
      `
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [email]
    );

    if (existing.rows?.length) {
      return res.status(409).json({ error: "Email already in use" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const inserted = await safeQuery(
      `
        INSERT INTO users (
          first_name,
          last_name,
          email,
          password_hash,
          role,
          firm_id,
          is_active,
          invited_by_user_id,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, true, $7, NOW())
        RETURNING
          id,
          first_name,
          last_name,
          email,
          role,
          firm_id,
          is_active,
          invited_by_user_id,
          created_at
      `,
      [
        first_name,
        last_name,
        email,
        password_hash,
        normalizedRole,
        adminUser.firm_id,
        adminUser.id
      ]
    );

    return res.status(201).json({
      success: true,
      user: inserted.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to create firm user"
    });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const adminUser = await getFirmAdminUser(req.authUser.id);

    if (!adminUser) {
      return res.status(404).json({ error: "Admin user not found" });
    }

    const targetUserId = Number(req.params.id);
    if (!Number.isFinite(targetUserId)) {
      return res.status(400).json({ error: "Invalid user id" });
    }

    const targetResult = await safeQuery(
      `
        SELECT
          id,
          first_name,
          last_name,
          email,
          role,
          firm_id,
          is_active
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [targetUserId]
    );

    const targetUser = targetResult.rows?.[0];
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (Number(targetUser.firm_id) !== Number(adminUser.firm_id)) {
      return res.status(403).json({ error: "Cannot manage users outside your firm" });
    }

    const allowedRoles = ["admin", "strategist", "analyst", "mailops", "user"];
    const nextRole = req.body?.role
      ? String(req.body.role).toLowerCase()
      : targetUser.role;

    if (!allowedRoles.includes(nextRole)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const nextActive =
      typeof req.body?.is_active === "boolean"
        ? req.body.is_active
        : Boolean(targetUser.is_active);

    if (Number(targetUser.id) === Number(adminUser.id) && nextActive === false) {
      return res.status(400).json({ error: "You cannot disable your own admin account" });
    }

    const updated = await safeQuery(
      `
        UPDATE users
        SET
          role = $1,
          is_active = $2
        WHERE id = $3
        RETURNING
          id,
          first_name,
          last_name,
          email,
          role,
          firm_id,
          is_active,
          invited_by_user_id,
          created_at
      `,
      [nextRole, nextActive, targetUserId]
    );

    return res.json({
      success: true,
      user: updated.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to update firm user"
    });
  }
});

export default router;
