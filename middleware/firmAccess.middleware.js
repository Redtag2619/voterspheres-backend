import { pool } from "../db/pool.js";

export async function requireFirmAccessToCampaign(req, res, next) {
  try {
    const campaignId = Number(req.params.id || req.params.campaignId);

    if (!campaignId) {
      return res.status(400).json({ error: "valid campaign id required" });
    }

    const result = await pool.query(
      `
      SELECT id, firm_id
      FROM campaigns
      WHERE id = $1
      LIMIT 1
      `,
      [campaignId]
    );

    const campaign = result.rows[0];

    if (!campaign) {
      return res.status(404).json({ error: "campaign not found" });
    }

    if (req.user?.role === "platform_admin") {
      req.campaign = campaign;
      return next();
    }

    if (!req.user?.firm_id) {
      return res.status(403).json({ error: "user has no firm access" });
    }

    if (Number(campaign.firm_id) !== Number(req.user.firm_id)) {
      return res.status(403).json({ error: "campaign access denied for this firm" });
    }

    req.campaign = campaign;
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireFirmAccessToFirm(req, res, next) {
  try {
    const firmId = Number(req.params.id || req.params.firmId);

    if (!firmId) {
      return res.status(400).json({ error: "valid firm id required" });
    }

    if (req.user?.role === "platform_admin") {
      return next();
    }

    if (!req.user?.firm_id) {
      return res.status(403).json({ error: "user has no firm access" });
    }

    if (Number(req.user.firm_id) !== Number(firmId)) {
      return res.status(403).json({ error: "firm access denied" });
    }

    next();
  } catch (err) {
    next(err);
  }
}
