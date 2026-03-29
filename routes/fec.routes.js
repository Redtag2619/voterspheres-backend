import express from "express";
import { requireEnterprise } from "../middleware/requirePlan.js";
import * as fecService from "../services/fecIngestion.service.js";

const router = express.Router();

function resolveHandler(...names) {
  for (const name of names) {
    if (typeof fecService[name] === "function") {
      return fecService[name];
    }
  }

  return (_req, res) => {
    return res.status(501).json({
      error: "Route handler not implemented",
      tried: names,
    });
  };
}

router.get(
  "/fundraising/leaderboard",
  requireEnterprise,
  resolveHandler(
    "getFundraisingLeaderboard",
    "getLeaderboard",
    "getFecFundraisingLeaderboard"
  )
);

router.get(
  "/fundraising/summary",
  requireEnterprise,
  resolveHandler(
    "getFundraisingSummary",
    "getSummary",
    "getFecFundraisingSummary"
  )
);

export default router;
