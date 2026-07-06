import express from "express";
import {
  getCampaignFinanceIntelligence,
  syncCampaignFinanceIntelligence,
} from "../services/campaignFinanceIntelligence.service.js";

const router = express.Router();

function asyncHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error("[Campaign Finance Intelligence]", error);
      res.status(500).json({
        ok: false,
        error: error.message || "Campaign Finance Intelligence request failed.",
      });
    }
  };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const data = await getCampaignFinanceIntelligence(req.query || {});
    res.json(data);
  })
);

router.post(
  "/sync",
  asyncHandler(async (req, res) => {
    const result = await syncCampaignFinanceIntelligence({
      ...(req.body || {}),
      ...(req.query || {}),
    });

    res.json({
      ok: true,
      message: "Campaign finance intelligence sync completed.",
      ...result,
    });
  })
);

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "campaign-finance-intelligence",
    timestamp: new Date().toISOString(),
  });
});

export default router;
