import express from "express";

const router = express.Router();

let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;

  const candidates = [
    "../config/database.js",
    "../config/db.js",
    "../db/pool.js",
    "../db.js",
    "../database.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      const db = mod.pool || mod.default || mod.db || null;
      if (db?.query) {
        cachedDb = db;
        return db;
      }
    } catch {
      // try next
    }
  }

  throw new Error("Database connection not found for workspace contacts route");
}

async function query(sql, params = []) {
  const db = await getDb();
  return db.query(sql, params);
}

function getFirmId(req) {
  return req.auth?.firmId || req.auth?.firm_id || req.user?.firm_id || null;
}

function getUserId(req) {
  return req.auth?.userId || req.user?.id || null;
}

function text(value = "") {
  return String(value ?? "").trim();
}

function email(value = "") {
  return text(value).toLowerCase();
}

async function ensureWorkspaceContactTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS workspace_client_contacts (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      workspace_id INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT,
      organization TEXT,
      phone TEXT,
      is_primary BOOLEAN DEFAULT false,
      notes TEXT,
      created_by_user_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`ALTER TABLE workspace_client_contacts ADD COLUMN IF NOT EXISTS firm_id INTEGER`);
  await query(`ALTER TABLE workspace_client_contacts ADD COLUMN IF NOT EXISTS workspace_id INTEGER`);
  await query(`ALTER TABLE workspace_client_contacts ADD COLUMN IF NOT EXISTS full_name TEXT`);
  await query(`ALTER TABLE workspace_client_contacts ADD COLUMN IF NOT EXISTS email TEXT`);
  await query(`ALTER TABLE workspace_client_contacts ADD COLUMN IF NOT EXISTS role TEXT`);
  await query(`ALTER TABLE workspace_client_contacts ADD COLUMN IF NOT EXISTS organization TEXT`);
  await query(`ALTER TABLE workspace_client_contacts ADD COLUMN IF NOT EXISTS phone TEXT`);
  await query(`ALTER TABLE workspace_client_contacts ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE workspace_client_contacts ADD COLUMN IF NOT EXISTS notes TEXT`);
  await query(`ALTER TABLE workspace_client_contacts ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER`);
  await query(`ALTER TABLE workspace_client_contacts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await query(`ALTER TABLE workspace_client_contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_workspace_client_contacts_firm_workspace
      ON workspace_client_contacts(firm_id, workspace_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_workspace_client_contacts_email
      ON workspace_client_contacts(LOWER(email))
  `);
}

async function requireWorkspaceAccess(req, res) {
  const firmId = getFirmId(req);
  const workspaceId = Number(req.params.workspaceId);

  if (!firmId) {
    res.status(401).json({ error: "Missing firm context" });
    return null;
  }

  if (!Number.isFinite(workspaceId)) {
    res.status(400).json({ error: "Invalid workspace id" });
    return null;
  }

  const result = await query(
    `
      SELECT id, firm_id, name
      FROM workspaces
      WHERE id = $1 AND firm_id = $2
      LIMIT 1
    `,
    [workspaceId, firmId]
  );

  const workspace = result.rows?.[0];

  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return null;
  }

  return { firmId, workspaceId, workspace };
}

router.get("/:workspaceId", async (req, res) => {
  try {
    await ensureWorkspaceContactTables();

    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const result = await query(
      `
        SELECT
          id,
          firm_id,
          workspace_id,
          full_name,
          email,
          role,
          organization,
          phone,
          is_primary,
          notes,
          created_by_user_id,
          created_at,
          updated_at
        FROM workspace_client_contacts
        WHERE firm_id = $1 AND workspace_id = $2
        ORDER BY is_primary DESC, created_at DESC, id DESC
      `,
      [access.firmId, access.workspaceId]
    );

    return res.json({
      ok: true,
      total: result.rows.length,
      results: result.rows
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load workspace client contacts"
    });
  }
});

router.post("/:workspaceId", async (req, res) => {
  try {
    await ensureWorkspaceContactTables();

    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const fullName = text(req.body.full_name || req.body.name);
    const contactEmail = email(req.body.email);
    const role = text(req.body.role);
    const organization = text(req.body.organization);
    const phone = text(req.body.phone);
    const notes = text(req.body.notes);
    const isPrimary = Boolean(req.body.is_primary);

    if (!fullName) {
      return res.status(400).json({ error: "Contact name is required" });
    }

    if (!contactEmail || !contactEmail.includes("@")) {
      return res.status(400).json({ error: "Valid contact email is required" });
    }

    if (isPrimary) {
      await query(
        `
          UPDATE workspace_client_contacts
          SET is_primary = false, updated_at = NOW()
          WHERE firm_id = $1 AND workspace_id = $2
        `,
        [access.firmId, access.workspaceId]
      );
    }

    const result = await query(
      `
        INSERT INTO workspace_client_contacts (
          firm_id,
          workspace_id,
          full_name,
          email,
          role,
          organization,
          phone,
          is_primary,
          notes,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
        RETURNING *
      `,
      [
        access.firmId,
        access.workspaceId,
        fullName,
        contactEmail,
        role || null,
        organization || null,
        phone || null,
        isPrimary,
        notes || null,
        getUserId(req)
      ]
    );

    return res.status(201).json({
      ok: true,
      contact: result.rows[0]
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to create workspace client contact"
    });
  }
});

router.patch("/:workspaceId/:contactId", async (req, res) => {
  try {
    await ensureWorkspaceContactTables();

    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const contactId = Number(req.params.contactId);
    if (!Number.isFinite(contactId)) {
      return res.status(400).json({ error: "Invalid contact id" });
    }

    const current = await query(
      `
        SELECT *
        FROM workspace_client_contacts
        WHERE id = $1 AND firm_id = $2 AND workspace_id = $3
        LIMIT 1
      `,
      [contactId, access.firmId, access.workspaceId]
    );

    const existing = current.rows?.[0];
    if (!existing) {
      return res.status(404).json({ error: "Contact not found" });
    }

    const nextPrimary =
      typeof req.body.is_primary === "boolean"
        ? req.body.is_primary
        : Boolean(existing.is_primary);

    if (nextPrimary) {
      await query(
        `
          UPDATE workspace_client_contacts
          SET is_primary = false, updated_at = NOW()
          WHERE firm_id = $1 AND workspace_id = $2 AND id <> $3
        `,
        [access.firmId, access.workspaceId, contactId]
      );
    }

    const result = await query(
      `
        UPDATE workspace_client_contacts
        SET
          full_name = $4,
          email = $5,
          role = $6,
          organization = $7,
          phone = $8,
          is_primary = $9,
          notes = $10,
          updated_at = NOW()
        WHERE id = $1 AND firm_id = $2 AND workspace_id = $3
        RETURNING *
      `,
      [
        contactId,
        access.firmId,
        access.workspaceId,
        req.body.full_name === undefined ? existing.full_name : text(req.body.full_name),
        req.body.email === undefined ? existing.email : email(req.body.email),
        req.body.role === undefined ? existing.role : text(req.body.role) || null,
        req.body.organization === undefined ? existing.organization : text(req.body.organization) || null,
        req.body.phone === undefined ? existing.phone : text(req.body.phone) || null,
        nextPrimary,
        req.body.notes === undefined ? existing.notes : text(req.body.notes) || null
      ]
    );

    return res.json({
      ok: true,
      contact: result.rows[0]
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to update workspace client contact"
    });
  }
});

router.delete("/:workspaceId/:contactId", async (req, res) => {
  try {
    await ensureWorkspaceContactTables();

    const access = await requireWorkspaceAccess(req, res);
    if (!access) return;

    const contactId = Number(req.params.contactId);
    if (!Number.isFinite(contactId)) {
      return res.status(400).json({ error: "Invalid contact id" });
    }

    const result = await query(
      `
        DELETE FROM workspace_client_contacts
        WHERE id = $1 AND firm_id = $2 AND workspace_id = $3
        RETURNING id
      `,
      [contactId, access.firmId, access.workspaceId]
    );

    if (!result.rows?.[0]) {
      return res.status(404).json({ error: "Contact not found" });
    }

    return res.json({
      ok: true,
      deleted: result.rows[0].id
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to delete workspace client contact"
    });
  }
});

export default router;
