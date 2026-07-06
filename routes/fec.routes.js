import express from "express";

import {
  getFundraisingLeaderboard,
  getLiveFundraising,
} from "../services/intelligence.service.js";

import { syncFundraisingFromFec } from "../services/fec.service.js";

const router = express.Router();

function asyncHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error("[FEC]", error);
      res.status(500).json({
        ok: false,
        error: error.message || "FEC request failed.",
      });
    }
  };
}

router.get(
  "/fundraising/live",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 1000), 5000);
    const results = await getLiveFundraising(limit);

    res.json({
      ok: true,
      source: "fec",
      updated_at: new Date().toISOString(),
      ...results,
    });
  })
);

router.get(
  "/fundraising/leaderboard",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 1000), 5000);

    const results = await getFundraisingLeaderboard({
      limit,
      state: req.query.state,
      party: req.query.party,
      office: req.query.office,
      candidate: req.query.candidate,
    });

    res.json({
      ok: true,
      source: "fec",
      updated_at: new Date().toISOString(),
      ...results,
    });
  })
);

router.post(
  "/sync/candidate-financials",
  asyncHandler(async (req, res) => {
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
      source: "fec",
      message: "FEC financial data imported successfully.",
      imported_at: new Date().toISOString(),
      ...result,
    });
  })
);

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "fec",
    status: "online",
    timestamp: new Date().toISOString(),
  });
});

export default router;
