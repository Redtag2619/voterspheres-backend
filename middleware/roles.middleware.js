import { requireCurrentRoles } from "./authorization.middleware.js";

export function requireRoles(...allowedRoles) {
  return requireCurrentRoles(...allowedRoles);
}
