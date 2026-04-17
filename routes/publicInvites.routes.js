import express from "express";
import bcrypt from "bcryptjs";

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
      "Database connection not available. Public invites route could not resolve your DB module."
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

router.get("/invite", async (req, res) => {
  try {
    const token = String(req.query?.token || "").trim();
    if (!token) {
      return res.status(400).json({ error: "Invite token is required" });
    }

    const result = await safeQuery(
      `
        SELECT
          i.id,
          i.firm_id,
          i.email,
          i.first_name,
          i.last_name,
          i.role,
          i.status,
          i.expires_at,
          f.name AS firm_name
        FROM firm_user_invites i
        LEFT JOIN firms f ON f.id = i.firm_id
        WHERE i.invite_token = $1
        LIMIT 1
      `,
      [token]
    );

    const invite = result.rows?.[0];
    if (!invite) {
      return res.status(404).json({ error: "Invite not found" });
    }

    if (invite.status !== "pending") {
      return res.status(400).json({ error: "Invite is no longer active" });
    }

    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "Invite has expired" });
    }

    return res.json({
      invite
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load invite"
    });
  }
});

router.post("/invite/accept", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");

    if (!token || !password) {
      return res.status(400).json({
        error: "Invite token and password are required"
      });
    }

    const result = await safeQuery(
      `
        SELECT *
        FROM firm_user_invites
        WHERE invite_token = $1
        LIMIT 1
      `,
      [token]
    );

    const invite = result.rows?.[0];
    if (!invite) {
      return res.status(404).json({ error: "Invite not found" });
    }

    if (invite.status !== "pending") {
      return res.status(400).json({ error: "Invite is no longer active" });
    }

    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "Invite has expired" });
    }

    const existingUser = await safeQuery(
      `
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [invite.email]
    );

    if (existingUser.rows?.length) {
      return res.status(409).json({
        error: "A user with this email already exists"
      });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const createdUser = await safeQuery(
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
        VALUES ($1,$2,$3,$4,$5,$6,true,$7,NOW())
        RETURNING
          id,
          first_name,
          last_name,
          email,
          role,
          firm_id,
          is_active,
          created_at
      `,
      [
        invite.first_name,
        invite.last_name,
        invite.email,
        password_hash,
        invite.role,
        invite.firm_id,
        invite.invited_by_user_id
      ]
    );

    const user = createdUser.rows?.[0];

    await safeQuery(
      `
        UPDATE firm_user_invites
        SET
          status = 'accepted',
          accepted_user_id = $1,
          accepted_at = NOW(),
          updated_at = NOW()
        WHERE id = $2
      `,
      [user.id, invite.id]
    );

    return res.status(201).json({
      success: true,
      user
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to accept invite"
    });
  }
});

export default router;
