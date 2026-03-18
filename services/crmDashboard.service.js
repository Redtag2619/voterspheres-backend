import { pool } from "../db/pool.js";
import { ensureCrmTables } from "../repositories/crm.repository.js";

function money(value) {
  return Number(value || 0);
}

function compactMoney(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

export async function getCrmDashboardSummary(_req, res, next) {
  try {
    await ensureCrmTables();

    const [
      campaignsResult,
      tasksResult,
      vendorsResult,
      firmsResult,
      usersResult,
      activityResult
    ] = await Promise.all([
      pool.query(`
        SELECT
          c.*,
          f.name AS firm_name
        FROM campaigns c
        LEFT JOIN firms f ON f.id = c.firm_id
        ORDER BY c.updated_at DESC, c.created_at DESC
      `),
      pool.query(`
        SELECT
          t.*,
          c.campaign_name,
          c.candidate_name
        FROM campaign_tasks t
        INNER JOIN campaigns c ON c.id = t.campaign_id
        WHERE t.status <> 'done'
        ORDER BY
          CASE t.priority
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
            ELSE 4
          END,
          t.due_date ASC NULLS LAST,
          t.updated_at DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT
          v.*,
          c.campaign_name,
          c.candidate_name
        FROM campaign_vendors v
        INNER JOIN campaigns c ON c.id = v.campaign_id
        ORDER BY v.updated_at DESC, v.created_at DESC
        LIMIT 10
      `),
      pool.query(`SELECT * FROM firms ORDER BY updated_at DESC, created_at DESC`),
      pool.query(`SELECT * FROM app_users ORDER BY updated_at DESC, created_at DESC`),
      pool.query(`
        SELECT
          a.*,
          c.campaign_name,
          c.candidate_name
        FROM campaign_activity a
        INNER JOIN campaigns c ON c.id = a.campaign_id
        ORDER BY a.created_at DESC
        LIMIT 12
      `)
    ]);

    const campaigns = campaignsResult.rows;
    const tasks = tasksResult.rows;
    const vendors = vendorsResult.rows;
    const firms = firmsResult.rows;
    const users = usersResult.rows;
    const activity = activityResult.rows;

    const activeCampaigns = campaigns.filter(
      (campaign) =>
        String(campaign.status || "").toLowerCase() !== "closed" &&
        String(campaign.stage || "").toLowerCase() !== "post-election"
    );

    const pipelineRevenue = campaigns.reduce(
      (sum, campaign) => sum + money(campaign.contract_value),
      0
    );

    const budgetTracked = campaigns.reduce(
      (sum, campaign) => sum + money(campaign.budget_total),
      0
    );

    const stageCounts = [
      "Lead",
      "Prospect",
      "Proposal",
      "Contracted",
      "Active Campaign",
      "Post-Election"
    ].map((stage) => ({
      stage,
      count: campaigns.filter((campaign) => campaign.stage === stage).length
    }));

    const activeCampaignRows = activeCampaigns.slice(0, 6).map((campaign) => ({
      id: campaign.id,
      campaign_name: campaign.campaign_name,
      candidate_name: campaign.candidate_name,
      office: campaign.office,
      state: campaign.state,
      party: campaign.party,
      stage: campaign.stage,
      status: campaign.status,
      contract_value: money(campaign.contract_value),
      budget_total: money(campaign.budget_total),
      firm_name: campaign.firm_name || null
    }));

    const vendorActivity = vendors.map((vendor) => ({
      id: vendor.id,
      vendor_name: vendor.vendor_name,
      category: vendor.category,
      status: vendor.status,
      contract_value: money(vendor.contract_value),
      campaign_id: vendor.campaign_id,
      campaign_name: vendor.campaign_name,
      candidate_name: vendor.candidate_name,
      updated_at: vendor.updated_at
    }));

    const taskAlerts = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      due_date: task.due_date,
      campaign_id: task.campaign_id,
      campaign_name: task.campaign_name,
      candidate_name: task.candidate_name
    }));

    const recentActivity = activity.map((item) => ({
      id: item.id,
      activity_type: item.activity_type,
      summary: item.summary,
      created_at: item.created_at,
      campaign_id: item.campaign_id,
      campaign_name: item.campaign_name,
      candidate_name: item.candidate_name
    }));

    res.json({
      metrics: [
        {
          label: "Active Campaigns",
          value: `${activeCampaigns.length}`,
          delta: "Open workspaces",
          tone: "up"
        },
        {
          label: "Pipeline Revenue",
          value: compactMoney(pipelineRevenue),
          delta: "Contract value tracked",
          tone: "up"
        },
        {
          label: "Budget Tracked",
          value: compactMoney(budgetTracked),
          delta: "Campaign budgets",
          tone: "up"
        },
        {
          label: "Task Alerts",
          value: `${taskAlerts.length}`,
          delta: "Open action items",
          tone: taskAlerts.length > 0 ? "alert" : "up"
        }
      ],
      summary: {
        firms: firms.length,
        users: users.length,
        campaigns: campaigns.length,
        active_campaigns: activeCampaigns.length,
        pipeline_revenue: pipelineRevenue,
        budget_tracked: budgetTracked
      },
      stage_counts: stageCounts,
      active_campaigns: activeCampaignRows,
      task_alerts: taskAlerts,
      vendor_activity: vendorActivity,
      recent_activity: recentActivity
    });
  } catch (err) {
    next(err);
  }
}
