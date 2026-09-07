import { pool } from "../db/pool.js";

function slugify(value) {
  return String(value || "workspace")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getFirmId(user = {}) {
  return user.firm_id || user.firmId || user.firm || null;
}

function requireFirmId(user = {}) {
  const firmId = Number(getFirmId(user));
  if (!Number.isInteger(firmId) || firmId <= 0) throw new Error("Missing firm context.");
  return firmId;
}

async function assertWorkspace(workspaceId, firmId, client = pool) {
  const result = await client.query(
    `SELECT id FROM campaign_workspaces WHERE id = $1 AND firm_id = $2 LIMIT 1`,
    [workspaceId, firmId]
  );
  if (!result.rows[0]) throw new Error("Campaign workspace not found.");
}

export async function listCampaignWorkspaces({ user }) {
  const firmId = requireFirmId(user);

  const { rows } = await pool.query(
    `
      SELECT
        w.*,
        COUNT(DISTINCT m.id)::int AS member_count,
        COUNT(DISTINCT t.id)::int AS target_count
      FROM campaign_workspaces w
      LEFT JOIN campaign_workspace_members m ON m.workspace_id = w.id
      LEFT JOIN campaign_workspace_targets t ON t.workspace_id = w.id
      WHERE w.firm_id = $1
      GROUP BY w.id
      ORDER BY w.updated_at DESC, w.created_at DESC
    `,
    [firmId]
  );

  return rows;
}

export async function getCampaignWorkspace({ id, user }) {
  const firmId = requireFirmId(user);

  const workspaceResult = await pool.query(
    `
      SELECT *
      FROM campaign_workspaces
      WHERE id = $1
      AND firm_id = $2
      LIMIT 1
    `,
    [id, firmId]
  );

  const workspace = workspaceResult.rows[0];

  if (!workspace) {
    throw new Error("Campaign workspace not found.");
  }

  const [members, targets] = await Promise.all([
    pool.query(
      `
        SELECT *
        FROM campaign_workspace_members
        WHERE workspace_id = $1
          AND EXISTS (SELECT 1 FROM campaign_workspaces w WHERE w.id = $1 AND w.firm_id = $2)
        ORDER BY created_at DESC
      `,
      [id, firmId]
    ),
    pool.query(
      `
        SELECT *
        FROM campaign_workspace_targets
        WHERE workspace_id = $1
          AND EXISTS (SELECT 1 FROM campaign_workspaces w WHERE w.id = $1 AND w.firm_id = $2)
        ORDER BY created_at DESC
      `,
      [id, firmId]
    ),
  ]);

  return {
    workspace,
    members: members.rows,
    targets: targets.rows,
  };
}

export async function createCampaignWorkspace({ payload, user }) {
  const firmId = requireFirmId(user);
  const name = payload.name || "New Campaign Workspace";
  const baseSlug = slugify(payload.slug || name);
  const slug = `${baseSlug}-${Date.now().toString().slice(-5)}`;

  const { rows } = await pool.query(
    `
      INSERT INTO campaign_workspaces (
        firm_id,
        name,
        slug,
        cycle,
        campaign_type,
        status,
        home_state,
        description,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `,
    [
      firmId,
      name,
      slug,
      payload.cycle || 2026,
      payload.campaign_type || "general",
      payload.status || "active",
      payload.home_state || null,
      payload.description || null,
      JSON.stringify(payload.metadata || {}),
    ]
  );

  return rows[0];
}

export async function updateCampaignWorkspace({ id, payload, user }) {
  const firmId = requireFirmId(user);

  const { rows } = await pool.query(
    `
      UPDATE campaign_workspaces
      SET
        name = COALESCE($3, name),
        cycle = COALESCE($4, cycle),
        campaign_type = COALESCE($5, campaign_type),
        status = COALESCE($6, status),
        home_state = COALESCE($7, home_state),
        description = COALESCE($8, description),
        metadata = COALESCE($9, metadata),
        updated_at = NOW()
      WHERE id = $1
      AND firm_id = $2
      RETURNING *
    `,
    [
      id,
      firmId,
      payload.name || null,
      payload.cycle || null,
      payload.campaign_type || null,
      payload.status || null,
      payload.home_state || null,
      payload.description || null,
      payload.metadata ? JSON.stringify(payload.metadata) : null,
    ]
  );

  if (!rows[0]) {
    throw new Error("Campaign workspace not found.");
  }

  return rows[0];
}

export async function addWorkspaceMember({ workspaceId, payload, user }) {
  const firmId = requireFirmId(user);
  await assertWorkspace(workspaceId, firmId);
  const { rows } = await pool.query(
    `
      INSERT INTO campaign_workspace_members (
        workspace_id,
        user_id,
        email,
        role,
        status
      )
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (workspace_id, email)
      DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status
      RETURNING *
    `,
    [
      workspaceId,
      payload.user_id || null,
      payload.email || null,
      payload.role || "member",
      payload.status || "active",
    ]
  );

  return rows[0];
}

export async function addWorkspaceTarget({ workspaceId, payload, user }) {
  const firmId = requireFirmId(user);
  await assertWorkspace(workspaceId, firmId);
  const { rows } = await pool.query(
    `
      INSERT INTO campaign_workspace_targets (
        workspace_id,
        target_type,
        state_code,
        county_name,
        race_name,
        candidate_name,
        priority,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `,
    [
      workspaceId,
      payload.target_type || "state",
      payload.state_code || null,
      payload.county_name || null,
      payload.race_name || null,
      payload.candidate_name || null,
      payload.priority || "normal",
      JSON.stringify(payload.metadata || {}),
    ]
  );

  return rows[0];
}

