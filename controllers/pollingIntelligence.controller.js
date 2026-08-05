
import {
  getPollingIntelligenceHealth,
  listPollingIntelligence,
} from "../services/pollingIntelligence.service.js";

import {
  getPollingIntelligenceJobStatus,
  runPollingIntelligenceJob,
} from "../jobs/pollingIntelligence.job.js";

export async function getPollingHealthController(_req, res, next) {
  try {
    res.json(await getPollingIntelligenceHealth());
  } catch (error) {
    next(error);
  }
}

export async function listPollingController(req, res, next) {
  try {
    res.json(
      await listPollingIntelligence({
        state: req.query?.state,
        office: req.query?.office,
        candidate: req.query?.candidate,
        recordType: req.query?.record_type,
        measuredOnly:
          String(req.query?.measured_only || "false").toLowerCase() === "true",
        limit: req.query?.limit,
      })
    );
  } catch (error) {
    next(error);
  }
}

export async function syncPollingController(req, res, next) {
  try {
    const result = await runPollingIntelligenceJob({
      includeHistorical: Boolean(req.body?.include_historical),
      generateEstimates: req.body?.generate_estimates !== false,
      estimateCycle: req.body?.cycle,
      lookbackDays: req.body?.lookback_days,
      retentionDays: req.body?.retention_days,
    });

    res.status(result.skipped ? 409 : 200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getPollingJobStatusController(_req, res, next) {
  try {
    res.json(getPollingIntelligenceJobStatus());
  } catch (error) {
    next(error);
  }
}
