import { requireFirmAdministrator } from "./authorization.middleware.js";

export async function requireFirmAdmin(req, res, next) {
  return requireFirmAdministrator(req, res, next);
}
