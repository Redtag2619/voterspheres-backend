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
      "Database connection not available. Beta admin route could not resolve your DB module."
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
    CREATE TABLE IF NOT EXISTS pending_signup_attempts (
      id SERIAL PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      firm_name TEXT,
      email TEXT NOT NULL,
      requested_role TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      source TEXT DEFAULT 'signup_form',
      approved_approval_id INTEGER,
      generated_invite_id INTEGER,
      reviewed_by_user_id INTEGER,
      reviewed_by_email TEXT,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await safeQuery(`
    CREATE INDEX IF NOT EXISTS idx_pending_signup_attempts_email
      ON pending_signup_attempts (LOWER(email))
  `);

  await safeQuery(`
    CREATE INDEX IF NOT EXISTS idx_pending_signup_attempts_status
      ON pending_signup_attempts (status)
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
      source_lead_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await safeQuery(`
    ALTER TABLE firm_user_invites
    ADD COLUMN IF NOT EXISTS source_lead_id INTEGER
  `);
}

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function normalizeDomain(domain = "") {
  return String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

function splitName(firstName = "", lastName = "") {
  return {
    first_name: String(firstName || "").trim(),
    last_name: String(lastName || "").trim()
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
    subject: "You're approved for VoterSpheres",
    text: [
      `Hi ${first_name || "there"},`,
      ``,
      `You've been approved for VoterSpheres and invited to join ${firm_name} as a ${role}.`,
      `Set your password here:`,
      invite_link,
      ``,
      `This link expires in 7 days.`
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <p>Hi ${first_name || "there"},</p>
        <p>You've been approved for <strong>VoterSpheres</strong> and invited to join <strong>${firm_name}</strong> as a <strong>${role}</strong>.</p>
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

    const q = String(req.query.q || "").trim();

    const result = await safeQuery(
      `
        SELECT
          id,
          email,
          domain,
          access_type,
          is_active,
          approved_by_user_id,
          approved_by_email,
          notes,
          created_at,
          updated_at
        FROM beta_access_approvals
        WHERE (
          $1 = ''
          OR COALESCE(email, '') ILIKE '%' || $1 || '%'
          OR COALESCE(domain, '') ILIKE '%' || $1 || '%'
          OR COALESCE(notes, '') ILIKE '%' || $1 || '%'
        )
        ORDER BY is_active DESC, created_at DESC
      `,
      [q]
    );

    return res.json({
      results: result.rows || []
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load beta approvals"
    });
  }
});

router.post("/", async (req, res) => {
  try {
    await ensureTables();

    const {
      access_type = "email",
      email = "",
      domain = "",
      notes = ""
    } = req.body || {};

    const normalizedType = String(access_type || "").trim().toLowerCase();

    if (!["email", "domain"].includes(normalizedType)) {
      return res.status(400).json({ error: "Invalid access_type" });
    }

    if (normalizedType === "email") {
      const normalizedEmail = normalizeEmail(email);

      if (!normalizedEmail) {
        return res.status(400).json({ error: "Email is required" });
      }

      const result = await safeQuery(
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
          notes || ""
        ]
      );

      return res.status(201).json({
        success: true,
        approval: result.rows?.[0] || null
      });
    }

    const normalizedDomain = normalizeDomain(domain);

    if (!normalizedDomain) {
      return res.status(400).json({ error: "Domain is required" });
    }

    const result = await safeQuery(
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
        VALUES (NULL, $1, 'domain', true, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (LOWER(domain)) WHERE domain IS NOT NULL
        DO UPDATE SET
          is_active = true,
          approved_by_user_id = EXCLUDED.approved_by_user_id,
          approved_by_email = EXCLUDED.approved_by_email,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        RETURNING *
      `,
      [
        normalizedDomain,
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        notes || ""
      ]
    );

    return res.status(201).json({
      success: true,
      approval: result.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to create beta approval"
    });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    await ensureTables();

    const id = Number(req.params.id);
    const { is_active, notes } = req.body || {};

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid approval id" });
    }

    const existing = await safeQuery(
      `
        SELECT *
        FROM beta_access_approvals
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    if (!existing.rows?.length) {
      return res.status(404).json({ error: "Approval not found" });
    }

    const current = existing.rows[0];

    const result = await safeQuery(
      `
        UPDATE beta_access_approvals
        SET
          is_active = $1,
          notes = $2,
          approved_by_user_id = $3,
          approved_by_email = $4,
          updated_at = NOW()
        WHERE id = $5
        RETURNING *
      `,
      [
        typeof is_active === "boolean" ? is_active : current.is_active,
        typeof notes === "string" ? notes : current.notes,
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        id
      ]
    );

    return res.json({
      success: true,
      approval: result.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to update beta approval"
    });
  }
});

router.get("/pending-signups", async (req, res) => {
  try {
    await ensureTables();

    const q = String(req.query.q || "").trim();

    const result = await safeQuery(
      `
        SELECT
          psa.id,
          psa.first_name,
          psa.last_name,
          psa.firm_name,
          psa.email,
          psa.requested_role,
          psa.notes,
          psa.status,
          psa.source,
          psa.approved_approval_id,
          psa.generated_invite_id,
          psa.reviewed_by_user_id,
          psa.reviewed_by_email,
          psa.reviewed_at,
          psa.created_at,
          psa.updated_at,
          EXISTS (
            SELECT 1
            FROM beta_access_approvals baa
            WHERE baa.is_active = true
              AND baa.email IS NOT NULL
              AND LOWER(baa.email) = LOWER(psa.email)
          ) AS already_approved
        FROM pending_signup_attempts psa
        WHERE psa.status IN ('pending', 'approved', 'invited', 'rejected')
          AND (
            $1 = ''
            OR COALESCE(psa.email, '') ILIKE '%' || $1 || '%'
            OR COALESCE(psa.first_name, '') ILIKE '%' || $1 || '%'
            OR COALESCE(psa.last_name, '') ILIKE '%' || $1 || '%'
            OR COALESCE(psa.firm_name, '') ILIKE '%' || $1 || '%'
          )
        ORDER BY
          CASE psa.status
            WHEN 'pending' THEN 0
            WHEN 'approved' THEN 1
            WHEN 'invited' THEN 2
            WHEN 'rejected' THEN 3
            ELSE 4
          END,
          psa.created_at DESC
      `,
      [q]
    );

    return res.json({
      results: result.rows || []
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load pending signup attempts"
    });
  }
});

router.post("/pending-signups/:id/approve", async (req, res) => {
  try {
    await ensureTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid pending signup id" });
    }

    const pendingResult = await safeQuery(
      `
        SELECT *
        FROM pending_signup_attempts
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    const attempt = pendingResult.rows?.[0];
    if (!attempt) {
      return res.status(404).json({ error: "Pending signup not found" });
    }

    const normalizedEmail = normalizeEmail(attempt.email);
    if (!normalizedEmail) {
      return res.status(400).json({ error: "Pending signup has no email" });
    }

    const approvalResult = await safeQuery(
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
        `Approved from pending signup attempt #${attempt.id}`
      ]
    );

    const approval = approvalResult.rows?.[0] || null;

    const updatedPending = await safeQuery(
      `
        UPDATE pending_signup_attempts
        SET
          status = 'approved',
          approved_approval_id = $1,
          reviewed_by_user_id = $2,
          reviewed_by_email = $3,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `,
      [
        approval?.id || null,
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        id
      ]
    );

    return res.json({
      success: true,
      approval,
      pending_signup: updatedPending.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to approve pending signup"
    });
  }
});

router.post("/pending-signups/:id/approve-and-invite", async (req, res) => {
  try {
    await ensureTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid pending signup id" });
    }

    if (!req.adminUser?.firm_id) {
      return res.status(400).json({ error: "Admin user has no firm_id" });
    }

    const pendingResult = await safeQuery(
      `
        SELECT *
        FROM pending_signup_attempts
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    const attempt = pendingResult.rows?.[0];
    if (!attempt) {
      return res.status(404).json({ error: "Pending signup not found" });
    }

    const normalizedEmail = normalizeEmail(attempt.email);
    if (!normalizedEmail) {
      return res.status(400).json({ error: "Pending signup has no email" });
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

    const approvalResult = await safeQuery(
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
        `Approved from pending signup attempt #${attempt.id}`
      ]
    );

    const approval = approvalResult.rows?.[0] || null;

    const { first_name, last_name } = splitName(attempt.first_name, attempt.last_name);
    const inviteRole = toInviteRole(attempt.requested_role);
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
          source_lead_id,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,NULL,NOW(),NOW())
        RETURNING *
      `,
      [
        req.adminUser.firm_id,
        normalizedEmail,
        first_name,
        last_name,
        inviteRole,
        inviteToken,
        req.adminUser.id,
        expiresAt,
        `Created from pending signup attempt #${attempt.id}`
      ]
    );

    const invite = inviteInsert.rows?.[0] || null;

    const firmResult = await safeQuery(
      `
        SELECT id, name
        FROM firms
        WHERE id = $1
        LIMIT 1
      `,
      [req.adminUser.firm_id]
    );

    const firmName = firmResult.rows?.[0]?.name || attempt.firm_name || "your firm";
    const inviteLink = `${getAppBaseUrl()}/accept-invite?token=${inviteToken}`;

    const mailResult = await sendInviteEmail({
      email: normalizedEmail,
      first_name,
      firm_name: firmName,
      invite_link: inviteLink,
      role: inviteRole
    });

    const updatedPending = await safeQuery(
      `
        UPDATE pending_signup_attempts
        SET
          status = 'invited',
          approved_approval_id = $1,
          generated_invite_id = $2,
          reviewed_by_user_id = $3,
          reviewed_by_email = $4,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $5
        RETURNING *
      `,
      [
        approval?.id || null,
        invite?.id || null,
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        id
      ]
    );

    return res.json({
      success: true,
      approval,
      invite,
      invite_link: inviteLink,
      email_sent: mailResult.sent,
      email_status: mailResult.reason || "sent",
      pending_signup: updatedPending.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to approve and invite pending signup"
    });
  }
});

router.patch("/pending-signups/:id/reject", async (req, res) => {
  try {
    await ensureTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid pending signup id" });
    }

    const result = await safeQuery(
      `
        UPDATE pending_signup_attempts
        SET
          status = 'rejected',
          reviewed_by_user_id = $1,
          reviewed_by_email = $2,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `,
      [
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        id
      ]
    );

    if (!result.rows?.length) {
      return res.status(404).json({ error: "Pending signup not found" });
    }

    return res.json({
      success: true,
      pending_signup: result.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to reject pending signup"
    });
  }
});

export default router;
