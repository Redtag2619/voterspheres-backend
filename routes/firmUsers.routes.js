import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import nodemailer from "nodemailer";
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

async function ensurePasswordResetTable() {
  await safeQuery(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      reset_token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await safeQuery(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
      ON password_reset_tokens (user_id)
  `);

  await safeQuery(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email
      ON password_reset_tokens (LOWER(email))
  `);

  await safeQuery(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token
      ON password_reset_tokens (reset_token)
  `);
}

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function getAppBaseUrl() {
  return (
    process.env.FRONTEND_APP_URL ||
    process.env.PUBLIC_APP_URL ||
    "https://www.voterspheres.org"
  );
}

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass
    }
  });
}

async function sendPasswordResetEmail({ email, first_name, reset_link }) {
  const transporter = createTransporter();
  if (!transporter) {
    return { sent: false, reason: "SMTP not configured" };
  }

  const fromEmail =
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    "no-reply@voterspheres.org";

  await transporter.sendMail({
    from: fromEmail,
    to: email,
    subject: "Reset your VoterSpheres password",
    text: [
      `Hi ${first_name || "there"},`,
      ``,
      `Use this link to reset your VoterSpheres password:`,
      reset_link,
      ``,
      `This link expires in 1 hour.`
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <p>Hi ${first_name || "there"},</p>
        <p>Use this link to reset your VoterSpheres password.</p>
        <p>
          <a href="${reset_link}" style="display:inline-block;padding:12px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;">
            Reset Password
          </a>
        </p>
        <p>If the button does not work, use this link:</p>
        <p><a href="${reset_link}">${reset_link}</a></p>
        <p>This link expires in 1 hour.</p>
      </div>
    `
  });

  return { sent: true };
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
    const normalizedUserEmail = normalizeEmail(email);

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
      [normalizedUserEmail]
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
        normalizedUserEmail,
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

router.post("/:id/send-password-reset", async (req, res) => {
  try {
    const adminUser = await getFirmAdminUser(req.authUser.id);

    if (!adminUser) {
      return res.status(404).json({ error: "Admin user not found" });
    }

    const targetUserId = Number(req.params.id);
    if (!Number.isFinite(targetUserId)) {
      return res.status(400).json({ error: "Invalid user id" });
    }

    const result = await safeQuery(
      `
        SELECT id, first_name, email, firm_id
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [targetUserId]
    );

    const user = result.rows?.[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (Number(user.firm_id) !== Number(adminUser.firm_id)) {
      return res.status(403).json({ error: "Cannot manage users outside your firm" });
    }

    await ensurePasswordResetTable();

    await safeQuery(
      `
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE user_id = $1
          AND used_at IS NULL
      `,
      [user.id]
    );

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    await safeQuery(
      `
        INSERT INTO password_reset_tokens (
          user_id,
          email,
          reset_token,
          expires_at
        )
        VALUES ($1,$2,$3,$4)
      `,
      [user.id, user.email, token, expires]
    );

    const resetLink = `${getAppBaseUrl()}/reset-password?token=${token}`;

    const mail = await sendPasswordResetEmail({
      email: user.email,
      first_name: user.first_name,
      reset_link: resetLink
    });

    return res.json({
      success: true,
      email_sent: mail.sent,
      email_status: mail.reason || "sent",
      reset_link: mail.sent ? undefined : resetLink
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to send reset"
    });
  }
});

export default router;
