```js
import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { pool } from "../db/pool.js";
import { getUnifiedExecutiveIntelligence } from "../services/unifiedExecutiveIntelligence.service.js";

const router = express.Router();

function userFromRequest(req) {
  return {
    ...(req.user || {}),
    ...(req.auth || {}),

    firm_id:
      req.auth?.firmId ||
      req.auth?.firm_id ||
      req.user?.firm_id ||
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

async function loadUnifiedExecutiveIntelligence(
  req,
  res
) {
  try {
    const data =
      await getUnifiedExecutiveIntelligence({
        user:
          userFromRequest(req),

        ...scopeFromRequest(req),
      });

    return res
      .status(200)
      .json(data);
  } catch (error) {
    console.error(
      "[unified-executive-intelligence] request failed:",
      error
    );

    return res
      .status(
        error.statusCode ||
          500
      )
      .json({
        ok: false,

        error:
          error.statusCode ===
          401
            ? "Missing firm context"
            : "Failed to load Unified Executive Intelligence.",

        detail:
          process.env
            .NODE_ENV ===
          "production"
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
      const user =
        userFromRequest(req);

      if (!user.firm_id) {
        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Missing firm context",
          });
      }

      const title = String(
        req.body?.title ||
          "Executive intelligence action"
      ).trim();

      const description =
        String(
          req.body
            ?.description ||
            req.body?.detail ||
            "Created from Unified Executive Intelligence."
        ).trim();

      const workspaceId =
        req.body
          ?.workspace_id ||
        null;

      const priority =
        String(
          req.body
            ?.priority ||
            "high"
        ).toLowerCase();

      const metadata = {
        recommendation_id:
          req.body
            ?.recommendation_id ||
          null,

        route:
          req.body?.route ||
          null,

        created_by_user_id:
          user.id ||
          user.userId ||
          null,
      };

      const result =
        await pool.query(
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
            JSON.stringify(
              metadata
            ),
          ]
        );

      return res
        .status(201)
        .json({
          ok: true,

          task:
            result.rows?.[0] ||
            null,
        });
    } catch (error) {
      console.error(
        "[unified-executive-intelligence] action creation failed:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "Failed to create executive action.",

          detail:
            process.env
              .NODE_ENV ===
            "production"
              ? undefined
              : error.message,
        });
    }
  }
);

export default router;
```
