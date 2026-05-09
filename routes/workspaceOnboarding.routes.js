import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

const DEFAULT_CHECKLIST = [
  {
    id: "client-setup",
    title: "Confirm client setup",
    description:
      "Verify firm name, primary contact, state focus, and onboarding goals.",
    category: "Client",
    priority: "High",
  },
  {
    id: "campaign-states",
    title: "Load priority states and campaigns",
    description:
      "Add battleground states, key races, candidate targets, and district priorities.",
    category: "Campaign",
    priority: "High",
  },
  {
    id: "reporting-template",
    title: "Create first executive report template",
    description:
      "Configure the workspace report layout, recipients, cadence, and delivery rules.",
    category: "Reports",
    priority: "High",
  },
  {
    id: "vendor-review",
    title: "Review vendor coverage",
    description:
      "Check field, mail, digital, polling, compliance, data, and fundraising vendor gaps.",
    category: "Vendors",
    priority: "Medium",
  },
  {
    id: "mailops-review",
    title: "Configure MailOps workflow",
    description:
      "Confirm mail drops, approvals, production dates, delivery windows, and risk alerts.",
    category: "MailOps",
    priority: "Medium",
  },
  {
    id: "command-center-signals",
    title: "Activate Command Center signals",
    description:
      "Review cross-signal priorities, alerts, intelligence feed, and rapid-response tasks.",
    category: "Command Center",
    priority: "High",
  },
];

function getUserId(req) {
  return req.auth?.userId || req.authUser?.id || req.user?.id || null;
}

function text(value = "") {
  return String(value ?? "").trim();
}

function normalizeWorkspaceId(value) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : null;
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function buildChecklist(rows = []) {
  const byItemId = new Map(rows.map((row) => [String(row.item_id), row]));

  return DEFAULT_CHECKLIST.map((item) => {
    const row = byItemId.get(item.id);

    return {
      ...item,
      complete: Boolean(row?.is_complete),
      completedAt: row?.completed_at || null,
      updatedAt: row?.updated_at || null,
      updatedByUserId: row?.updated_by_user_id || null,
    };
  });
}

async function ensureWorkspaceOnboardingTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_onboarding_checklist (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      is_complete BOOLEAN NOT NULL DEFAULT false,
      completed_at TIMESTAMP,
      updated_by_user_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, item_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS workspace_onboarding_workspace_idx
      ON workspace_onboarding_checklist(workspace_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS workspace_onboarding_item_idx
      ON workspace_onboarding_checklist(item_id)
  `);
}

router.get("/:workspaceId/onboarding-checklist", requireAuth, async (req, res) => {
  try {
    await ensureWorkspaceOnboardingTables();

    const workspaceId = normalizeWorkspaceId(req.params.workspaceId);

    if (!workspaceId) {
      return res.status(400).json({ error: "Invalid workspace id" });
    }

    const result = await pool.query(
      `
        SELECT *
        FROM workspace_onboarding_checklist
        WHERE workspace_id = $1
        ORDER BY id ASC
      `,
      [workspaceId]
    );

    const checklist = buildChecklist(result.rows || []);
    const completedCount = checklist.filter((item) => item.complete).length;

    return res.json({
      ok: true,
      workspace_id: workspaceId,
      checklist,
      summary: {
        total: checklist.length,
        completed: completedCount,
        completionRate: checklist.length
          ? Math.round((completedCount / checklist.length) * 100)
          : 0,
      },
    });
  } catch (error) {
    console.error("Workspace onboarding checklist load error:", error);

    return res.status(500).json({
      error: error.message || "Failed to load workspace onboarding checklist",
    });
  }
});

router.put(
  "/:workspaceId/onboarding-checklist/:itemId",
  requireAuth,
  async (req, res) => {
    try {
      await ensureWorkspaceOnboardingTables();

      const workspaceId = normalizeWorkspaceId(req.params.workspaceId);
      const itemId = text(req.params.itemId);
      const isComplete = normalizeBoolean(
        req.body?.complete ?? req.body?.is_complete
      );

      if (!workspaceId) {
        return res.status(400).json({ error: "Invalid workspace id" });
      }

      if (!DEFAULT_CHECKLIST.some((item) => item.id === itemId)) {
        return res.status(400).json({ error: "Invalid checklist item id" });
      }

      const result = await pool.query(
        `
          INSERT INTO workspace_onboarding_checklist (
            workspace_id,
            item_id,
            is_complete,
            completed_at,
            updated_by_user_id,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            $3,
            CASE WHEN $3 = true THEN NOW() ELSE NULL END,
            $4,
            NOW(),
            NOW()
          )
          ON CONFLICT (workspace_id, item_id)
          DO UPDATE SET
            is_complete = EXCLUDED.is_complete,
            completed_at = CASE
              WHEN EXCLUDED.is_complete = true
                THEN COALESCE(workspace_onboarding_checklist.completed_at, NOW())
              ELSE NULL
            END,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = NOW()
          RETURNING *
        `,
        [workspaceId, itemId, isComplete, getUserId(req)]
      );

      const rows = await pool.query(
        `
          SELECT *
          FROM workspace_onboarding_checklist
          WHERE workspace_id = $1
          ORDER BY id ASC
        `,
        [workspaceId]
      );

      const checklist = buildChecklist(rows.rows || []);
      const completedCount = checklist.filter((item) => item.complete).length;

      return res.json({
        ok: true,
        item: result.rows[0],
        workspace_id: workspaceId,
        checklist,
        summary: {
          total: checklist.length,
          completed: completedCount,
          completionRate: checklist.length
            ? Math.round((completedCount / checklist.length) * 100)
            : 0,
        },
      });
    } catch (error) {
      console.error("Workspace onboarding checklist update error:", error);

      return res.status(500).json({
        error:
          error.message || "Failed to update workspace onboarding checklist",
      });
    }
  }
);

router.delete("/:workspaceId/onboarding-checklist", requireAuth, async (req, res) => {
  try {
    await ensureWorkspaceOnboardingTables();

    const workspaceId = normalizeWorkspaceId(req.params.workspaceId);

    if (!workspaceId) {
      return res.status(400).json({ error: "Invalid workspace id" });
    }

    await pool.query(
      `
        DELETE FROM workspace_onboarding_checklist
        WHERE workspace_id = $1
      `,
      [workspaceId]
    );

    const checklist = buildChecklist([]);

    return res.json({
      ok: true,
      workspace_id: workspaceId,
      checklist,
      summary: {
        total: checklist.length,
        completed: 0,
        completionRate: 0,
      },
    });
  } catch (error) {
    console.error("Workspace onboarding checklist reset error:", error);

    return res.status(500).json({
      error: error.message || "Failed to reset workspace onboarding checklist",
    });
  }
});

export default router;
