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

  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  return number;
}

function sanitizeGraphQuery(query = {}) {
  /*
   * Explicit allowlist.
   *
   * Never forward firm_id, firmId, user_id, workspace_id,
   * role, plan tier, or other authorization-related values
   * supplied by the client.
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
      query[key] !== null
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

    return res.json({
      ok: true,

      /*
       * This identifies the authenticated tenant making the request.
       * It is intentionally NOT accepted from req.query.
       */
      firm_id: firmId,

      graph,

      /*
       * Preserve the existing flattened response contract so current
       * frontend consumers do not break.
       */
      ...graph,
    });
  } catch (error) {
    console.error("[relationships] graph failed", {
      message: error?.message,
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
