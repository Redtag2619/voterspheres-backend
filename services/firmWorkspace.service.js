import { pool } from "../db/pool.js";
import { ensureCrmTables } from "../repositories/crm.repository.js";

function money(value) {
  return Number(value || 0);
}

export async function getFirmWorkspace(req, res, next) {
  try {
    await ensureCrmTables();

    const firmId = Number(req.params.id);
    if (!firmId) {
      return res.status(400).json({ error: "valid firm id required" });
    }

    const firmResult = await pool.query(
      `
      SELECT *
      FROM firms
      WHERE id = $1
      `,
      [firmId]
    );

    const firm = firmResult.rows[0];
    if (!firm) {
      return res.status(404).json({ error: "firm not found" });
    }

    const [usersResult, campaignsResult, vendorsResult, activityResult] =
      await Promise.all([
        pool.query(
          `
          SELECT *
          FROM app_users
          WHERE firm_id = $1
          ORDER BY updated_at DESC, last_name ASC, first_name ASC
          `,
          [firmId]
        ),
        pool.query(
          `
          SELECT
            c.*,
            u.first_name AS owner_first_name,
            u.last_name AS owner_last_name
          FROM campaigns c
          LEFT JOIN app_users u ON u.id = c.owner_user_id
          WHERE c.firm_id = $1
          ORDER BY c.updated_at DESC, c.created_at DESC
          `,
          [firmId]
        ),
        pool.query(
          `
          SELECT
            v.*,
            c.campaign_name,
            c.candidate_name,
            c.state
          FROM campaign_vendors v
          INNER JOIN campaigns c ON c.id = v.campaign_id
          WHERE c.firm_id = $1
          ORDER BY v.updated_at DESC, v.created_at DESC
          LIMIT 20
          `,
          [firmId]
        ),
        pool.query(
          `
          SELECT
            a.*,
            c.campaign_name,
            c.candidate_name
          FROM campaign_activity a
          INNER JOIN campaigns c ON c.id = a.campaign_id
          WHERE c.firm_id = $1
          ORDER BY a.created_at DESC
          LIMIT 25
          `,
          [firmId]
        )
      ]);

    const users = usersResult.rows;
    const campaigns = campaignsResult.rows;
    const vendors = vendorsResult.rows;
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

    const totalBudget = campaigns.reduce(
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

    const stateExposureMap = {};
    for (const campaign of campaigns) {
      const state = campaign.state || "Unknown";
      stateExposureMap[state] = (stateExposureMap[state] || 0) + 1;
    }

    const stateExposure = Object.entries(stateExposureMap)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      firm,
      metrics: [
        {
          label: "Firm Users",
          value: `${users.length}`,
          delta: "Team members",
          tone: "up"
        },
        {
          label: "Active Campaigns",
          value: `${activeCampaigns.length}`,
          delta: "Open workspaces",
          tone: "up"
        },
        {
          label: "Pipeline Revenue",
          value: `$${pipelineRevenue.toLocaleString()}`,
          delta: "Tracked contract value",
          tone: "up"
        },
        {
          label: "Budget Tracked",
          value: `$${totalBudget.toLocaleString()}`,
          delta: "Campaign budgets",
          tone: "up"
        }
      ],
      summary: {
        users: users.length,
        campaigns: campaigns.length,
        active_campaigns: activeCampaigns.length,
        pipeline_revenue: pipelineRevenue,
        budget_tracked: totalBudget
      },
      team: users,
      campaigns,
      active_campaigns: activeCampaigns,
      stage_counts: stageCounts,
      state_exposure: stateExposure,
      vendor_activity: vendors,
      recent_activity: activity
    });
  } catch (err) {
    next(err);
  }
}
