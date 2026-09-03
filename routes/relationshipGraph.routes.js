import express from "express";

import { requireAuth } from "../middleware/auth.middleware.js";
import { getRelationshipGraph } from "../services/relationshipGraph.service.js";

const router = express.Router();

function authenticatedFirmId(req) {
  const value =
    req.auth?.firmId ||
    req.auth?.firm_id ||
    req.user?.firm_id ||
    null;

  const firmId = Number(value);

  if (!Number.isInteger(firmId) || firmId <= 0) {
    return null;
  }

  return firmId;
}

function sanitizeGraphQuery(query = {}) {
  /*
   * Explicit public graph-filter allowlist.
   *
   * Authorization and tenant fields supplied by the client are
   * intentionally ignored. This prevents query parameters such as:
   *
   *   firm_id
   *   firmId
   *   user_id
   *   workspace_id
   *   role
   *
   * from influencing authenticated tenant identity.
   */
  const allowed = [
    "cycle",
    "state",
    "party",
    "office",
    "search",
    "committee",
    "consultant",
    "candidate",
    "minAmount",
    "min_amount",
    "limit",
  ];

  const options = {};

  for (const key of allowed) {
    if (
      Object.prototype.hasOwnProperty.call(query, key) &&
      query[key] !== undefined &&
      query[key] !== null &&
      query[key] !== ""
    ) {
      options[key] = query[key];
    }
  }

  return options;
}

router.get("/graph", requireAuth, async (req, res) => {
  try {
    const firmId = authenticatedFirmId(req);

    if (!firmId) {
      return res.status(403).json({
        ok: false,
        error: "Authenticated firm context is required",
      });
    }

    const options = sanitizeGraphQuery(req.query || {});

    const graph = await getRelationshipGraph(options);

    return res.status(200).json({
      ok: true,

      /*
       * Authenticated firm identity is database-derived through
       * requireAuth. It is never accepted from query parameters.
       */
      firm_id: firmId,

      graph,

      /*
       * Preserve the existing flattened graph contract for current
       * frontend consumers.
       */
      ...graph,
    });
  } catch (error) {
    console.error("[relationship-graph] failed", {
      message: error?.message || String(error),
      user_id: req.user?.id || null,
      firm_id:
        req.auth?.firmId ||
        req.auth?.firm_id ||
        req.user?.firm_id ||
        null,
    });

    return res.status(500).json({
      ok: false,
      error: "Failed to load relationship graph",
    });
  }
});

export default router;
