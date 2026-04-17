import express from "express";
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
      "Database connection not available. Firm invites route could not resolve your DB module."
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

async function ensureInviteTable() {
  await safeQuery(`
    CREATE TABLE IF NOT EXISTS firm_user_invites (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      invite_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      invited_by_user_id INTEGER,
      accepted_user_id INTEGER,
      expires_at TIMESTAMP NOT NULL,
      accepted_at TIMESTAMP,
      revoked_at TIMESTAMP,
      notes TEXT,
      source_lead_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await safeQuery(`
    CREATE INDEX IF NOT EXISTS idx_firm_user_invites_source_lead_id
      ON firm_user_invites (source_lead_id)
  `);
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

function makeInviteToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getInviteExpiryDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date;
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
    auth: { user, pass }
  });
}

async function sendInviteEmail({ email, first_name, firm_name, invite_link, role }) {
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
    subject: "You're invited to join VoterSpheres",
    text: [
      `Hi ${first_name || "there"},`,
      ``,
      `You've been invited to join ${firm_name} on VoterSpheres as a ${role}.`,
      `Set your password here:`,
      invite_link,
      ``,
      `This link expires in 7 days.`
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <p>Hi ${first_name || "there"},</p>
        <p>You've been invited to join <strong>${firm_name}</strong> on VoterSpheres as a <strong>${role}</strong>.</p>
        <p>
          <a href="${invite_link}" style="display:inline-block;padding:12px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;">
            Set your password
          </a>
        </p>
        <p>If the button does not work, use this link:</p>
        <p><a href="${invite_link}">${invite_link}</a></p>
        <p>This link expires in 7 days.</p>
      </div>
    `
  });

  return { sent: true };
}

router.use(requireFirmAdmin);

router.get("/", async (req, res) => {
  try {
    await ensureInviteTable();

    const adminUser = await getFirmAdminUser(req.authUser.id);
    if (!adminUser) {
      return res.status(404).json({ error: "Admin user not found" });
    }

    const result = await safeQuery(
      `
        SELECT
          id,
          firm_id,
          email,
          first_name,
          last_name,
          role,
          status,
          invited_by_user_id,
          accepted_user_id,
          expires_at,
          accepted_at,
          revoked_at,
          notes,
          source_lead_id,
          created_at,
          updated_at
        FROM firm_user_invites
        WHERE firm_id = $1
        ORDER BY created_at DESC
      `,
      [adminUser.firm_id]
    );

    return res.json({
      results: result.rows || []
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load firm invites"
    });
  }
});

router.post("/", async (req, res) => {
  try {
    await ensureInviteTable();

    const adminUser = await getFirmAdminUser(req.authUser.id);
    if (!adminUser) {
      return res.status(404).json({ error: "Admin user not found" });
    }

    const {
      first_name = "",
      last_name = "",
      email = "",
      role = "user",
      notes = "",
      source_lead_id = null
    } = req.body || {};

    if (!email || !first_name || !last_name) {
      return res.status(400).json({
        error: "First name, last name, and email are required"
      });
    }

    const allowedRoles = ["admin", "strategist", "analyst", "mailops", "user"];
    const normalizedRole = String(role || "user").toLowerCase();
    const normalizedEmail = String(email).trim().toLowerCase();

    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const existingUser = await safeQuery(
      `
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [normalizedEmail]
    );

    if (existingUser.rows?.length) {
      return res.status(409).json({ error: "A user with this email already exists" });
    }

    const inviteToken = makeInviteToken();
    const expiresAt = getInviteExpiryDate();

    const insertResult = await safeQuery(
      `
        INSERT INTO firm_user_invites (
          firm_id,
          email,
          first_name,
          last_name,
          role,
          invite_token,
          status,
          invited_by_user_id,
          expires_at,
          notes,
          source_lead_id,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,NOW(),NOW())
        RETURNING *
      `,
      [
        adminUser.firm_id,
        normalizedEmail,
        first_name,
        last_name,
        normalizedRole,
        inviteToken,
        adminUser.id,
        expiresAt,
        notes,
        source_lead_id
      ]
    );

    const invite = insertResult.rows?.[0] || null;

    const firmResult = await safeQuery(
      `
        SELECT id, name
        FROM firms
        WHERE id = $1
        LIMIT 1
      `,
      [adminUser.firm_id]
    );

    const firmName = firmResult.rows?.[0]?.name || "your firm";
    const inviteLink = `${getAppBaseUrl()}/accept-invite?token=${inviteToken}`;

    const mailResult = await sendInviteEmail({
      email: normalizedEmail,
      first_name,
      firm_name: firmName,
      invite_link: inviteLink,
      role: normalizedRole
    });

    return res.status(201).json({
      success: true,
      invite,
      invite_link: inviteLink,
      email_sent: mailResult.sent,
      email_status: mailResult.reason || "sent"
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to create invite"
    });
  }
});

router.post("/:id/resend", async (req, res) => {
  try {
    await ensureInviteTable();

    const adminUser = await getFirmAdminUser(req.authUser.id);
    if (!adminUser) {
      return res.status(404).json({ error: "Admin user not found" });
    }

    const inviteId = Number(req.params.id);
    if (!Number.isFinite(inviteId)) {
      return res.status(400).json({ error: "Invalid invite id" });
    }

    const result = await safeQuery(
      `
        SELECT *
        FROM firm_user_invites
        WHERE id = $1 AND firm_id = $2
        LIMIT 1
      `,
      [inviteId, adminUser.firm_id]
    );

    const invite = result.rows?.[0];
    if (!invite) {
      return res.status(404).json({ error: "Invite not found" });
    }

    if (invite.status === "accepted") {
      return res.status(400).json({ error: "Invite has already been accepted" });
    }

    const newToken = makeInviteToken();
    const newExpiry = getInviteExpiryDate();

    const updated = await safeQuery(
      `
        UPDATE firm_user_invites
        SET
          invite_token = $1,
          expires_at = $2,
          status = 'pending',
          updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `,
      [newToken, newExpiry, inviteId]
    );

    const refreshedInvite = updated.rows?.[0];

    const firmResult = await safeQuery(
      `
        SELECT id, name
        FROM firms
        WHERE id = $1
        LIMIT 1
      `,
      [adminUser.firm_id]
    );

    const firmName = firmResult.rows?.[0]?.name || "your firm";
    const inviteLink = `${getAppBaseUrl()}/accept-invite?token=${newToken}`;

    const mailResult = await sendInviteEmail({
      email: refreshedInvite.email,
      first_name: refreshedInvite.first_name,
      firm_name: firmName,
      invite_link: inviteLink,
      role: refreshedInvite.role
    });

    return res.json({
      success: true,
      invite: refreshedInvite,
      invite_link: inviteLink,
      email_sent: mailResult.sent,
      email_status: mailResult.reason || "sent"
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to resend invite"
    });
  }
});

router.patch("/:id/revoke", async (req, res) => {
  try {
    await ensureInviteTable();

    const adminUser = await getFirmAdminUser(req.authUser.id);
    if (!adminUser) {
      return res.status(404).json({ error: "Admin user not found" });
    }

    const inviteId = Number(req.params.id);
    if (!Number.isFinite(inviteId)) {
      return res.status(400).json({ error: "Invalid invite id" });
    }

    const updated = await safeQuery(
      `
        UPDATE firm_user_invites
        SET
          status = 'revoked',
          revoked_at = NOW(),
          updated_at = NOW()
        WHERE id = $1 AND firm_id = $2
        RETURNING *
      `,
      [inviteId, adminUser.firm_id]
    );

    if (!updated.rows?.length) {
      return res.status(404).json({ error: "Invite not found" });
    }

    return res.json({
      success: true,
      invite: updated.rows[0]
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to revoke invite"
    });
  }
});

export default router;
