import express from "express";
import { requireEnterprise } from "../middleware/requirePlan.js";
import {
  getFundraisingLeaderboard,
  getLiveFundraising,
} from "../services/intelligence.service.js";
import { syncFundraisingFromFec } from "../services/fec.service.js";

const router = express.Router();

router.get("/fundraising/live", requireEnterprise, async (req, res) => {
  try {
    res.json(await getLiveFundraising(req.query));
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get("/fundraising/leaderboard", requireEnterprise, async (req, res) => {
  try {
    res.json(await getFundraisingLeaderboard(req.query));
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post("/sync/candidate-financials", requireEnterprise, async (req, res) => {
  try {
    const cycle = Number(
      req.body?.cycle ||
        req.query?.cycle ||
        process.env.FEC_DEFAULT_CYCLE ||
        2026
    );

    const result = await syncFundraisingFromFec({
      cycle,
      syncContacts: true,
      contactLimit: Number(process.env.FEC_CONTACT_SYNC_LIMIT || 500),
      contactOffset: 0,
    });

    res.json({
      ok: true,
      message: "FEC candidate financials imported.",
      ...result,
    });
  } catch (error) {
    console.error("[FEC sync] failed:", error);

    res.status(500).json({
      ok: false,
      error: error.message || "FEC sync failed.",
    });
  }
});

export default router;
