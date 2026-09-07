import { pool } from "../db/pool.js";

export function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function currentFirmId(req) {
  return positiveId(req.user?.firm_id);
}

export function requireFirmContext(req, res, next) {
  const firmId = currentFirmId(req);
  if (!firmId) return res.status(403).json({ ok: false, error: "Firm access required" });
  req.tenant = { firmId };
  return next();
}

export function requireCurrentRoles(...roles) {
  const allowed = new Set(roles.map((role) => String(role).trim().toLowerCase()));
  return function currentRoleGuard(req, res, next) {
    const role = String(req.user?.role || "").trim().toLowerCase();
    if (!role) return res.status(401).json({ ok: false, error: "Authentication required" });
    if (!allowed.has(role)) return res.status(403).json({ ok: false, error: "Insufficient permissions" });
    return next();
  };
}

export const requirePlatformOperator = requireCurrentRoles("platform_admin", "super_admin", "platform_operator");
export const requireFirmAdministrator = requireCurrentRoles("platform_admin", "super_admin", "firm_admin", "admin");

export async function assertOwnedWorkspace(workspaceId, firmId, client = pool) {
  const id = positiveId(workspaceId);
  const tenant = positiveId(firmId);
  if (!id || !tenant) return null;
  const result = await client.query(`SELECT * FROM workspaces WHERE id = $1 AND firm_id = $2 LIMIT 1`, [id, tenant]);
  return result.rows[0] || null;
}

