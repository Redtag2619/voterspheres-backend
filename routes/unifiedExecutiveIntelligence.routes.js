import express from "express";

import { requireAuth } from "../middleware/auth.middleware.js";

import { pool } from "../db/pool.js";

import { getUnifiedExecutiveIntelligence } from "../services/unifiedExecutiveIntelligence.service.js";

 

const router = express.Router();

 

const INACTIVE_WORKSPACE_STATUSES = new Set([

  "archived",

  "inactive",

  "disabled",

]);

 

function userFromRequest(req) {

  const auth = req.auth || {};

  const user = req.user || {};

 

  return {

    ...user,

    ...auth,

    firm_id:

      auth.firmId ||

      auth.firm_id ||

      user.firmId ||

      user.firm_id ||

      user.firm?.id ||

      null,

  };

}

 

function scopeFromRequest(req) {

  return {

    workspaceId:

      req.query?.workspace_id ||

      req.body?.workspace_id ||

      null,

 

    state:

      req.query?.state ||

      req.body?.state ||

      "",

 

    office:

      req.query?.office ||

      req.body?.office ||

      "",

 

    risk:

      req.query?.risk ||

      req.body?.risk ||

      "",

  };

}

 

function clean(value = "") {

  return String(value ?? "").trim();

}

 

function normalizeWorkspaceId(value) {

  const raw = clean(value);

 

  if (!raw) return null;

 

  const parsed = Number(raw);

 

  if (!Number.isInteger(parsed) || parsed <= 0) {

    const error = new Error("Invalid workspace_id.");

    error.statusCode = 400;

    throw error;

  }

 

  return parsed;

}

 

async function validateWorkspaceAccess({ workspaceId, firmId }) {

  if (!workspaceId) return null;

 

  const result = await pool.query(

    `

      SELECT

        id,

        firm_id,

        name,

        status

      FROM workspaces

      WHERE id = $1

        AND firm_id = $2

      LIMIT 1

    `,

    [workspaceId, firmId]

  );

 

  const workspace = result.rows?.[0] || null;

 

  if (!workspace) {

    const error = new Error(

      "Workspace is not available for this firm."

    );

    error.statusCode = 403;

    throw error;

  }

 

  const status = clean(workspace.status || "active").toLowerCase();

 

  if (INACTIVE_WORKSPACE_STATUSES.has(status)) {

    const error = new Error(

      "Workspace is archived, inactive, or disabled."

    );

    error.statusCode = 409;

    throw error;

  }

 

  return workspace;

}

 

async function loadUnifiedExecutiveIntelligence(req, res) {

  try {

    const data = await getUnifiedExecutiveIntelligence({

      user: userFromRequest(req),

      ...scopeFromRequest(req),

    });

 

    return res.status(200).json(data);

  } catch (error) {

    console.error(

      "[unified-executive-intelligence] request failed:",

      error

    );

 

    return res.status(error.statusCode || 500).json({

      ok: false,

 

      error:

        error.statusCode === 401

          ? "Missing firm context"

          : "Failed to load Unified Executive Intelligence.",

 

      detail:

        process.env.NODE_ENV === "production"

          ? undefined

          : error.message,

    });

  }

}

 

router.get(

  "/",

  requireAuth,

  loadUnifiedExecutiveIntelligence

);

 

router.get(

  "/overview",

  requireAuth,

  loadUnifiedExecutiveIntelligence

);

 

router.get(

  "/briefing",

  requireAuth,

  loadUnifiedExecutiveIntelligence

);

 

router.get(

  "/signals",

  requireAuth,

  loadUnifiedExecutiveIntelligence

);

 

router.get(

  "/recommendations",

  requireAuth,

  loadUnifiedExecutiveIntelligence

);

 

router.get(

  "/workspaces",

  requireAuth,

  loadUnifiedExecutiveIntelligence

);

 

router.post(

  "/refresh",

  requireAuth,

  loadUnifiedExecutiveIntelligence

);

 

router.post(

  "/actions",

  requireAuth,

  async (req, res) => {

    try {

      const user = userFromRequest(req);

 

      if (!user.firm_id) {

        return res.status(401).json({

          ok: false,

          error: "Missing firm context",

        });

      }

 

      const title = clean(

        req.body?.title ||

          "Executive intelligence action"

      );

 

      const description = clean(

        req.body?.description ||

          req.body?.detail ||

          "Created from Unified Executive Intelligence."

      );

 

      if (!title) {

        return res.status(400).json({

          ok: false,

          error: "Executive action title is required.",

        });

      }

 

      const workspaceId = normalizeWorkspaceId(

        req.body?.workspace_id

      );

 

      const workspace = await validateWorkspaceAccess({

        workspaceId,

        firmId: user.firm_id,

      });

 

      const priority = clean(

        req.body?.priority ||

          "high"

      ).toLowerCase();

 

      const metadata = {

        ...(req.body?.metadata && typeof req.body.metadata === "object"

          ? req.body.metadata

          : {}),

 

        recommendation_id:

          req.body?.recommendation_id ||

          req.body?.metadata?.recommendation_id ||

          null,

 

        route:

          req.body?.route ||

          req.body?.metadata?.route ||

          null,

 

        created_by_user_id:

          user.id ||

          user.userId ||

          null,

 

        workspace_assignment:

          workspace

            ? {

                mode: "explicit_validated_workspace",

                workspace_id: workspace.id,

                workspace_name: workspace.name,

                workspace_status: workspace.status || "active",

              }

            : {

                mode: "firm_wide",

                workspace_id: null,

              },

      };

 

      const result = await pool.query(

        `

          INSERT INTO tasks (

            firm_id,

            workspace_id,

            title,

            description,

            status,

            priority,

            source,

            metadata,

            created_at,

            updated_at

          )

          VALUES (

            $1,

            $2,

            $3,

            $4,

            'open',

            $5,

            'unified_executive_intelligence',

            $6::jsonb,

            NOW(),

            NOW()

          )

          RETURNING *

        `,

        [

          user.firm_id,

          workspaceId,

          title,

          description,

          priority,

          JSON.stringify(metadata),

        ]

      );

 

      return res.status(201).json({

        ok: true,

        task: result.rows?.[0] || null,

      });

    } catch (error) {

      console.error(

        "[unified-executive-intelligence] action creation failed:",

        error

      );

 

      return res.status(error.statusCode || 500).json({

        ok: false,

        error:

          error.statusCode === 400 ||

          error.statusCode === 403 ||

          error.statusCode === 409

            ? error.message

            : "Failed to create executive action.",

 

        detail:

          process.env.NODE_ENV === "production"

            ? undefined

            : error.message,

      });

    }

  }

);

 

export default router;
