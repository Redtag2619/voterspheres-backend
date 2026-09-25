
import express from "express";
import {
  getFundraisingLeaderboard,
  getLiveFundraising,
} from "../services/intelligence.service.js";
import { syncFundraisingFromFec } from "../services/fec.service.js";
import { requirePlatformOperator } from "../middleware/authorization.middleware.js";
import {
  normalizeFederalElectionCycle,
  sendElectionCycleError,
} from "../utils/electionCycle.js";

const router = express.Router();

function asyncHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (sendElectionCycleError(res, error)) return;
      console.error("[FEC]", error);
      res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message || "FEC request failed.",
      });
    }
  };
}

function requestCycle(req) {
  return normalizeFederalElectionCycle(
    req.body?.cycle ?? req.query?.cycle,
    { fallback: process.env.FEC_DEFAULT_CYCLE || 2026, fieldName: "cycle" }
  );
}

router.get(
  "/fundraising/live",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 1000), 1), 5000);
    const cycle = requestCycle(req);
    const results = await getLiveFundraising({ limit, cycle });
    res.json({
      ok: true,
      source: "fec",
      cycle,
      updated_at: new Date().toISOString(),
      results,
      leaderboard: results,
    });
  })
);

router.get(
  "/fundraising/leaderboard",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 1000), 1), 5000);
    const cycle = requestCycle(req);
    const results = await getFundraisingLeaderboard({
      limit,
      cycle,
      state: req.query.state,
      party: req.query.party,
      office: req.query.office,
      candidate: req.query.candidate,
      pac: req.query.pac,
    });
    res.json({ ok: true, source: "fec", cycle, updated_at: new Date().toISOString(), ...results });
  })
);

router.post(
  "/sync/candidate-financials",
  requirePlatformOperator,
  asyncHandler(async (req, res) => {
    const cycle = requestCycle(req);
    const result = await syncFundraisingFromFec({
      cycle,

      syncContacts: true,
      contactLimit: Number(process.env.FEC_CONTACT_SYNC_LIMIT || 500),
      contactOffset: 0,
    });
    res.json({
      ok: true,
      source: "fec",
      cycle,
      message: "FEC financial data imported successfully.",
      imported_at: new Date().toISOString(),
      ...result,
    });
  })
);

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "fec", status: "online", timestamp: new Date().toISOString() });
});

export default router;
