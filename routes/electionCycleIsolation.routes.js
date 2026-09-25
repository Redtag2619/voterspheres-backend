
import express from "express";
import { requirePlatformOperator } from "../middleware/authorization.middleware.js";
import {
  auditElectionCycleIsolation,
  listElectionCycleRemediation,
  resolveCandidateElectionCycle,
} from "../services/electionCycleIsolation.service.js";

const router = express.Router();

function sendError(res, error) {
  const status = Number(error?.statusCode || error?.status || 500);
  return res.status(status).json({ ok: false, error: error?.message || "Election-cycle isolation request failed." });
}

router.get("/audit", requirePlatformOperator, async (_req, res) => {
  try {
    res.json({ ok: true, ...(await auditElectionCycleIsolation()) });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/remediation", requirePlatformOperator, async (req, res) => {
  try {
    const results = await listElectionCycleRemediation({
      status: req.query.status || "pending",
      entityTable: req.query.entity_table || null,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ ok: true, results });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/remediation/:id/resolve", requirePlatformOperator, async (req, res) => {
  try {
    const candidate = await resolveCandidateElectionCycle({
      remediationId: req.params.id,
      cycle: req.body?.cycle,
      note: req.body?.note,
      userId: req.user?.id,
    });
    res.json({ ok: true, candidate });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
