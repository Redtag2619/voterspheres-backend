import { pool } from "../db/pool.js";
import { ensureCrmTables } from "../repositories/crm.repository.js";

async function ensureMailTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_programs (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER,
      name TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_drops (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER,
      program_id INTEGER,
      drop_date DATE,
      quantity INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_tracking_events (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER,
      mail_drop_id INTEGER,
      event_type TEXT,
      status TEXT,
      location_name TEXT,
      facility_type TEXT,
      notes TEXT,
      source TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

function n(value) {
  return Number(value || 0);
}

function money(value) {
  return `$${n(value).toLocaleString()}`;
}

export async function getExecutiveDashboard(req, res, next) {
  try {
    await ensureCrmTables();
    await ensureMailTables();

    const [
      firmsResult,
      campaignsResult,
      campaignRevenueResult,
      tasksResult,
      vendorsResult,
      fundraisingResult,
      forecastResult,
      mapResult,
      mailDropsResult,
      mailDelayedResult,
      mailEventsResult,
      activityResult
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM firms`),

      pool.query(`
        SELECT
          c.*,
          u.first_name AS owner_first_name,
          u.last_name AS owner_last_name
        FROM campaigns c
        LEFT JOIN app_users u ON u.id = c.owner_user_id
        ORDER BY c.updated_at DESC, c.created_at DESC
        LIMIT 12
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
      `),

      pool.query(`
        SELECT
          t.*,
          c.campaign_name,
          c.candidate_name
        FROM campaign_tasks t
        INNER JOIN campaigns c ON c.id = t.campaign_id
        WHERE LOWER(COALESCE(t.status, 'todo')) <> 'done'
        ORDER BY
          CASE
            WHEN LOWER(COALESCE(t.priority, 'medium')) = 'high' THEN 1
            WHEN LOWER(COALESCE(t.priority, 'medium')) = 'medium' THEN 2
            ELSE 3
          END,
          t.created_at DESC
        LIMIT 10
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
        LIMIT 10
      `),

      pool.query(`
        SELECT
          candidate_name,
          state,
          office,
          party,
          total_receipts,
          total_disbursements,
          cash_on_hand,
          receipts_last_cycle
        FROM fundraising
        ORDER BY COALESCE(total_receipts, 0) DESC
        LIMIT 10
      `).catch(() => ({ rows: [] })),

      pool.query(`
        SELECT *
        FROM forecast_snapshots
        ORDER BY created_at DESC
        LIMIT 1
      `).catch(() => ({ rows: [] })),

      pool.query(`
        SELECT state_name, score, margin, category
        FROM map_overlays
        ORDER BY ABS(COALESCE(margin, 0)) ASC, COALESCE(score, 0) DESC
        LIMIT 10
      `).catch(() => ({ rows: [] })),

      pool.query(`
        SELECT COUNT(*)::int AS total
        FROM mail_drops
      `),

      pool.query(`
        SELECT COUNT(DISTINCT mail_drop_id)::int AS total
        FROM mail_tracking_events
        WHERE LOWER(COALESCE(event_type, '')) = 'delayed'
      `),

      pool.query(`
        SELECT *
        FROM mail_tracking_events
        ORDER BY created_at DESC
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
        LIMIT 15
      `)
    ]);

    const revenue = campaignRevenueResult.rows[0] || {};
    const activeCampaigns = campaignsResult.rows || [];
    const taskAlerts = tasksResult.rows || [];
    const vendorActivity = vendorsResult.rows || [];
    const fundraisingLeaders = fundraisingResult.rows || [];
    const battlegrounds = mapResult.rows || [];
    const mailTimeline = mailEventsResult.rows || [];
    const recentActivity = activityResult.rows || [];

    const snapshot = forecastResult.rows?.[0] || null;

    const pipelineRevenue = n(revenue.pipeline_revenue);
    const trackedBudget = n(revenue.tracked_budget);
    const activeCampaignCount = n(revenue.active_campaigns);
    const totalCampaignCount = n(revenue.total_campaigns);
    const firmCount = n(firmsResult.rows?.[0]?.total);

    const highPriorityTasks = taskAlerts.filter(
      (task) => String(task.priority || "").toLowerCase() === "high"
    ).length;

    const delayedMailDrops = n(mailDelayedResult.rows?.[0]?.total);
    const totalMailDrops = n(mailDropsResult.rows?.[0]?.total);

    const battlegroundStates = battlegrounds.length;
    const fundraisingTop = fundraisingLeaders[0] || null;

    res.json({
      metrics: [
        {
          label: "Active Campaigns",
          value: `${activeCampaignCount}`,
          delta: `${totalCampaignCount} tracked campaigns`,
          tone: "up"
        },
        {
          label: "Pipeline Revenue",
          value: money(pipelineRevenue),
          delta: "Firm-wide contract value",
          tone: "up"
        },
        {
          label: "Battleground States",
          value: `${battlegroundStates}`,
          delta: "Live overlay surface",
          tone: "up"
        },
        {
          label: "Task Alerts",
          value: `${highPriorityTasks}`,
          delta: "High-priority open tasks",
          tone: highPriorityTasks > 0 ? "down" : "up"
        },
        {
          label: "Mail Delay Alerts",
          value: `${delayedMailDrops}`,
          delta: `${totalMailDrops} total drops`,
          tone: delayedMailDrops > 0 ? "down" : "up"
        },
        {
          label: "Tracked Budget",
          value: money(trackedBudget),
          delta: `${firmCount} firms in CRM`,
          tone: "up"
        }
      ],
      summary: {
        firms: firmCount,
        campaigns_total: totalCampaignCount,
        campaigns_active: activeCampaignCount,
        pipeline_revenue: pipelineRevenue,
        tracked_budget: trackedBudget,
        battleground_states: battlegroundStates,
        high_priority_tasks: highPriorityTasks,
        delayed_mail_drops: delayedMailDrops,
        total_mail_drops: totalMailDrops
      },
      active_campaigns: activeCampaigns,
      pipeline: {
        total_revenue: pipelineRevenue,
        tracked_budget: trackedBudget,
        total_campaigns: totalCampaignCount,
        active_campaigns: activeCampaignCount
      },
      battleground_states: battlegrounds,
      fundraising_leaders: fundraisingLeaders,
      task_alerts: taskAlerts,
      vendor_activity: vendorActivity,
      mail_intelligence: {
        delayed_mail_drops: delayedMailDrops,
        total_mail_drops: totalMailDrops,
        recent_events: mailTimeline
      },
      forecast: snapshot
        ? {
            id: snapshot.id,
            snapshot_run_id: snapshot.snapshot_run_id,
            created_at: snapshot.created_at,
            published_at: snapshot.published_at,
            race_count: snapshot.race_count,
            tossup_count: snapshot.tossup_count,
            high_confidence_count: snapshot.high_confidence_count
          }
        : null,
      top_fundraiser: fundraisingTop,
      recent_activity: recentActivity
    });
  } catch (err) {
    next(err);
  }
}
