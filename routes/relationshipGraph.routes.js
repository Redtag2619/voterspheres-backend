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

      firm_id: firmId,

      graph,

      ...graph,

    });

  } catch (error) {

    const statusCode = Number(error?.statusCode) === 503 ? 503 : 500;

 

    console.error("[relationship-graph] failed", {

      message: error?.message || String(error),

      code: error?.code || null,

      cause: error?.cause?.message || null,

      user_id: req.user?.id || null,

      firm_id:

        req.auth?.firmId ||

        req.auth?.firm_id ||

        req.user?.firm_id ||

        null,

    });

 

    return res.status(statusCode).json({

      ok: false,

      error:

        statusCode === 503

          ? "Relationship graph data source is temporarily unavailable."

          : "Failed to load relationship graph",

      code:

        statusCode === 503

          ? "RELATIONSHIP_GRAPH_DATA_UNAVAILABLE"

          : "RELATIONSHIP_GRAPH_FAILED",

      detail:

        process.env.NODE_ENV === "production"

          ? undefined

          : error?.message,

    });

  }

});

 

export default router;

