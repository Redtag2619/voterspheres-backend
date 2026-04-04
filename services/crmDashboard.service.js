import { pool } from "../db/pool.js";
import { ensureCrmTables } from "../repositories/crm.repository.js"; 

export async function getCrmDashboardSummary(req, res, next) {
  try {
    await ensureCrmTables();

    const [
      firmsResult,
      campaignsResult,
      tasksResult,
      vendorsResult,
      activityResult,
      revenueResult
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM firms`),
      pool.query(`
        SELECT *
        FROM campaigns
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 12
      `),
      pool.query(`
        SELECT *
        FROM campaign_tasks
        WHERE LOWER(COALESCE(status, '')) <> 'done'
        ORDER BY created_at DESC
        LIMIT 12
      `),
      pool.query(`
        SELECT
          v.*,
          c.campaign_name,
          c.candidate_name,
          c.state
        FROM campaign_vendors v
        INNER JOIN campaigns c ON c.id = v.campaign_id
        ORDER BY v.updated_at DESC, v.created_at DESC
        LIMIT 12
      `),
      pool.query(`
        SELECT
          a.*,
          c.campaign_name,
          c.candidate_name
        FROM campaign_activity a
        INNER JOIN campaigns c ON c.id = a.campaign_id
        ORDER BY a.created_at DESC
        LIMIT 20
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS total_campaigns,
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(status, 'open')) = 'open'
          )::int AS active_campaigns,
          COALESCE(SUM(contract_value), 0)::numeric AS pipeline_revenue,
          COALESCE(SUM(budget_total), 0)::numeric AS tracked_budget
        FROM campaigns
      `)
    ]);

    const revenue = revenueResult.rows[0] || {};

    res.json({
      metrics: [
        {
          label: "Firms",
          value: `${firmsResult.rows[0]?.total || 0}`,
          delta: "CRM accounts",
          tone: "up"
        },
        {
          label: "Active Campaigns",
          value: `${revenue.active_campaigns || 0}`,
          delta: "Open workspaces",
          tone: "up"
        },
        {
          label: "Pipeline Revenue",
          value: `$${Number(revenue.pipeline_revenue || 0).toLocaleString()}`,
          delta: "Tracked contract value",
          tone: "up"
        },
        {
          label: "Tracked Budget",
          value: `$${Number(revenue.tracked_budget || 0).toLocaleString()}`,
          delta: "Campaign budgets",
          tone: "up"
        }
      ],
      summary: {
        firms: Number(firmsResult.rows[0]?.total || 0),
        total_campaigns: Number(revenue.total_campaigns || 0),
        active_campaigns: Number(revenue.active_campaigns || 0),
        pipeline_revenue: Number(revenue.pipeline_revenue || 0),
        tracked_budget: Number(revenue.tracked_budget || 0)
      },
      active_campaigns: campaignsResult.rows || [],
      task_alerts: tasksResult.rows || [],
      vendor_activity: vendorsResult.rows || [],
      recent_activity: activityResult.rows || []
    });
  } catch (err) {
    next(err);
  }
}
