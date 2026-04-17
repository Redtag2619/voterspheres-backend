import express from "express";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { requireRoles } from "../middleware/roles.middleware.js";

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
      "Database connection not available. Enterprise leads admin route could not resolve your DB module."
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

async function ensureTables() {
  await safeQuery(`
    CREATE TABLE IF NOT EXISTS enterprise_leads (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      firm_name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      notes TEXT,
      source TEXT DEFAULT 'landing_page',
      status TEXT DEFAULT 'new',
      reviewed_by_user_id INTEGER,
      reviewed_by_email TEXT,
      reviewed_at TIMESTAMP,
      review_notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await safeQuery(`
    CREATE TABLE IF NOT EXISTS beta_access_approvals (
      id SERIAL PRIMARY KEY,
      email TEXT,
      domain TEXT,
      access_type TEXT NOT NULL DEFAULT 'email',
      is_active BOOLEAN DEFAULT true,
      approved_by_user_id INTEGER,
      approved_by_email TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await safeQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_beta_access_approvals_email
      ON beta_access_approvals (LOWER(email))
      WHERE email IS NOT NULL
  `);

  await safeQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_beta_access_approvals_domain
      ON beta_access_approvals (LOWER(domain))
      WHERE domain IS NOT NULL
  `);

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
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function splitName(fullName = "") {
  const clean = String(fullName || "").trim();
  if (!clean) {
    return { first_name: "", last_name: "" };
  }

  const parts = clean.split(/\s+/);
  if (parts.length === 1) {
    return { first_name: parts[0], last_name: "" };
  }

  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts.slice(-1).join("")
  };
}

function toInviteRole(role = "") {
  const normalized = String(role || "").trim().toLowerCase();

  if (["admin", "strategist", "analyst", "mailops", "user"].includes(normalized)) {
    return normalized;
  }

  return "user";
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

async function hydrateAdminUser(req, _res, next) {
  try {
    const result = await safeQuery(
      `
        SELECT id, email, role, firm_id
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.authUser.id]
    );

    req.adminUser = result.rows?.[0] || null;
    return next();
  } catch (error) {
    return next(error);
  }
}

router.use(requireRoles("admin"));
router.use(hydrateAdminUser);

router.get("/", async (req, res) => {
  try {
    await ensureTables();

    const { status = "", q = "" } = req.query;

    const result = await safeQuery(
      `
        SELECT
          id,
          full_name,
          firm_name,
          email,
          role,
          notes,
          source,
          status,
          reviewed_by_user_id,
          reviewed_by_email,
          reviewed_at,
          review_notes,
          created_at,
          updated_at
        FROM enterprise_leads
        WHERE ($1 = '' OR status = $1)
          AND (
            $2 = ''
            OR COALESCE(full_name, '') ILIKE '%' || $2 || '%'
            OR COALESCE(firm_name, '') ILIKE '%' || $2 || '%'
            OR COALESCE(email, '') ILIKE '%' || $2 || '%'
            OR COALESCE(role, '') ILIKE '%' || $2 || '%'
          )
        ORDER BY
          CASE status
            WHEN 'new' THEN 0
            WHEN 'contacted' THEN 1
            WHEN 'qualified' THEN 2
            WHEN 'won' THEN 3
            WHEN 'archived' THEN 4
            ELSE 5
          END,
          created_at DESC
      `,
      [status, q]
    );

    return res.json({
      results: result.rows || []
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load enterprise leads"
    });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    await ensureTables();

    const id = Number(req.params.id);
    const { status = "", review_notes = "" } = req.body || {};

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    const allowedStatuses = ["new", "contacted", "qualified", "won", "archived"];
    if (!allowedStatuses.includes(String(status))) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const updated = await safeQuery(
      `
        UPDATE enterprise_leads
        SET
          status = $1,
          review_notes = $2,
          reviewed_by_user_id = $3,
          reviewed_by_email = $4,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $5
        RETURNING *
      `,
      [status, review_notes, req.adminUser?.id || null, req.adminUser?.email || null, id]
    );

    if (!updated.rows?.length) {
      return res.status(404).json({ error: "Lead not found" });
    }

    return res.json({
      success: true,
      lead: updated.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to update enterprise lead"
    });
  }
});

router.post("/:id/approve", async (req, res) => {
  try {
    await ensureTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    const leadResult = await safeQuery(
      `
        SELECT *
        FROM enterprise_leads
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    const lead = leadResult.rows?.[0];
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const normalizedEmail = normalizeEmail(lead.email);

    const approval = await safeQuery(
      `
        INSERT INTO beta_access_approvals (
          email,
          domain,
          access_type,
          is_active,
          approved_by_user_id,
          approved_by_email,
          notes,
          created_at,
          updated_at
        )
        VALUES ($1, NULL, 'email', true, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (LOWER(email)) WHERE email IS NOT NULL
        DO UPDATE SET
          is_active = true,
          approved_by_user_id = EXCLUDED.approved_by_user_id,
          approved_by_email = EXCLUDED.approved_by_email,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        RETURNING *
      `,
      [
        normalizedEmail,
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        `Approved from enterprise lead #${lead.id}`
      ]
    );

    const updatedLead = await safeQuery(
      `
        UPDATE enterprise_leads
        SET
          status = CASE WHEN status = 'new' THEN 'qualified' ELSE status END,
          review_notes = COALESCE(review_notes, '') || CASE WHEN COALESCE(review_notes, '') = '' THEN '' ELSE E'\n' END || $1,
          reviewed_by_user_id = $2,
          reviewed_by_email = $3,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `,
      [
        "Converted to beta approval",
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        id
      ]
    );

    return res.json({
      success: true,
      approval: approval.rows?.[0] || null,
      lead: updatedLead.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to approve enterprise lead"
    });
  }
});

router.post("/:id/invite", async (req, res) => {
  try {
    await ensureTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    if (!req.adminUser?.firm_id) {
      return res.status(400).json({ error: "Admin user has no firm_id" });
    }

    const leadResult = await safeQuery(
      `
        SELECT *
        FROM enterprise_leads
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    const lead = leadResult.rows?.[0];
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const existingUser = await safeQuery(
      `
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [normalizeEmail(lead.email)]
    );

    if (existingUser.rows?.length) {
      return res.status(409).json({ error: "A user with this email already exists" });
    }

    const nameParts = splitName(lead.full_name);
    const inviteRole = toInviteRole(lead.role);
    const inviteToken = makeInviteToken();
    const expiresAt = getInviteExpiryDate();

    const inviteInsert = await safeQuery(
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
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,NOW(),NOW())
        RETURNING *
      `,
      [
        req.adminUser.firm_id,
        normalizeEmail(lead.email),
        nameParts.first_name,
        nameParts.last_name,
        inviteRole,
        inviteToken,
        req.adminUser.id,
        expiresAt,
        `Created from enterprise lead #${lead.id}`
      ]
    );

    const firmResult = await safeQuery(
      `
        SELECT id, name
        FROM firms
        WHERE id = $1
        LIMIT 1
      `,
      [req.adminUser.firm_id]
    );

    const firmName = firmResult.rows?.[0]?.name || lead.firm_name || "your firm";
    const inviteLink = `${getAppBaseUrl()}/accept-invite?token=${inviteToken}`;

    const mailResult = await sendInviteEmail({
      email: normalizeEmail(lead.email),
      first_name: nameParts.first_name,
      firm_name: firmName,
      invite_link: inviteLink,
      role: inviteRole
    });

    const updatedLead = await safeQuery(
      `
        UPDATE enterprise_leads
        SET
          status = CASE WHEN status IN ('new', 'contacted') THEN 'qualified' ELSE status END,
          review_notes = COALESCE(review_notes, '') || CASE WHEN COALESCE(review_notes, '') = '' THEN '' ELSE E'\n' END || $1,
          reviewed_by_user_id = $2,
          reviewed_by_email = $3,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `,
      [
        "Invite created from enterprise lead",
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        id
      ]
    );

    return res.json({
      success: true,
      invite: inviteInsert.rows?.[0] || null,
      invite_link: inviteLink,
      email_sent: mailResult.sent,
      email_status: mailResult.reason || "sent",
      lead: updatedLead.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to invite enterprise lead"
    });
  }
});

router.post("/:id/approve-and-invite", async (req, res) => {
  try {
    await ensureTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    if (!req.adminUser?.firm_id) {
      return res.status(400).json({ error: "Admin user has no firm_id" });
    }

    const leadResult = await safeQuery(
      `
        SELECT *
        FROM enterprise_leads
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    const lead = leadResult.rows?.[0];
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const normalizedEmail = normalizeEmail(lead.email);

    const approval = await safeQuery(
      `
        INSERT INTO beta_access_approvals (
          email,
          domain,
          access_type,
          is_active,
          approved_by_user_id,
          approved_by_email,
          notes,
          created_at,
          updated_at
        )
        VALUES ($1, NULL, 'email', true, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (LOWER(email)) WHERE email IS NOT NULL
        DO UPDATE SET
          is_active = true,
          approved_by_user_id = EXCLUDED.approved_by_user_id,
          approved_by_email = EXCLUDED.approved_by_email,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        RETURNING *
      `,
      [
        normalizedEmail,
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        `Approved from enterprise lead #${lead.id}`
      ]
    );

    const existingUser = await safeQuery(
      `
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [normalizedEmail]
    );

    let invite = null;
    let inviteLink = null;
    let emailSent = false;
    let emailStatus = "skipped_existing_user";

    if (!existingUser.rows?.length) {
      const nameParts = splitName(lead.full_name);
      const inviteRole = toInviteRole(lead.role);
      const inviteToken = makeInviteToken();
      const expiresAt = getInviteExpiryDate();

      const inviteInsert = await safeQuery(
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
            created_at,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,NOW(),NOW())
          RETURNING *
        `,
        [
          req.adminUser.firm_id,
          normalizedEmail,
          nameParts.first_name,
          nameParts.last_name,
          inviteRole,
          inviteToken,
          req.adminUser.id,
          expiresAt,
          `Created from enterprise lead #${lead.id}`
        ]
      );

      invite = inviteInsert.rows?.[0] || null;
      inviteLink = `${getAppBaseUrl()}/accept-invite?token=${inviteToken}`;

      const firmResult = await safeQuery(
        `
          SELECT id, name
          FROM firms
          WHERE id = $1
          LIMIT 1
        `,
        [req.adminUser.firm_id]
      );

      const firmName = firmResult.rows?.[0]?.name || lead.firm_name || "your firm";

      const mailResult = await sendInviteEmail({
        email: normalizedEmail,
        first_name: nameParts.first_name,
        firm_name: firmName,
        invite_link: inviteLink,
        role: inviteRole
      });

      emailSent = mailResult.sent;
      emailStatus = mailResult.reason || "sent";
    }

    const updatedLead = await safeQuery(
      `
        UPDATE enterprise_leads
        SET
          status = 'qualified',
          review_notes = COALESCE(review_notes, '') || CASE WHEN COALESCE(review_notes, '') = '' THEN '' ELSE E'\n' END || $1,
          reviewed_by_user_id = $2,
          reviewed_by_email = $3,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `,
      [
        "Converted to beta approval and invite workflow",
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        id
      ]
    );

    return res.json({
      success: true,
      approval: approval.rows?.[0] || null,
      invite,
      invite_link: inviteLink,
      email_sent: emailSent,
      email_status: emailStatus,
      lead: updatedLead.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to approve and invite enterprise lead"
    });
  }
});

export default router;
