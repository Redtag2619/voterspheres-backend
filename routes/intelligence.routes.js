import express from "express";
import { requirePro, requireEnterprise } from "../middleware/requirePlan.js";
import * as intelligenceService from "../services/intelligence.service.js";

const router = express.Router();

function resolveHandler(...names) {
  for (const name of names) {
    if (typeof intelligenceService[name] === "function") {
      return intelligenceService[name];
    }
  }

  return (_req, res) => {
    return res.status(501).json({
      error: "Route handler not implemented",
      tried: names,
    });
  };
}

// General / lower-friction intelligence route
router.get(
  "/map",
  resolveHandler(
    "getMapIntelligence",
    "getMapOverview",
    "getIntelligenceMap",
    "getMapData"
  )
);

// Pro routes
router.get(
  "/forecast/overlays",
  requirePro,
  resolveHandler(
    "getForecastOverlays",
    "getForecastOverlay",
    "getForecastData",
    "getForecastIntelligence"
  )
);

router.get(
  "/rankings",
  requirePro,
  resolveHandler(
    "getPowerRankings",
    "getRankings",
    "getCandidateRankings",
    "getIntelligenceRankings"
  )
);

// Enterprise routes
router.get(
  "/fundraising/leaderboard",
  requireEnterprise,
  resolveHandler(
    "getFundraisingLeaderboard",
    "getLeaderboard",
    "getFundraisingData",
    "getFundraisingIntelligence"
  )
);

export default router;
