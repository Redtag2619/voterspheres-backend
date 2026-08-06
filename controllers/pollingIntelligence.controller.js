import {
  getPollingIntelligenceHealth,
  listPollingIntelligence,
} from "../services/pollingIntelligence.service.js";

import {
  getPollingIntelligenceJobStatus,
  runPollingIntelligenceJob,
} from "../jobs/pollingIntelligence.job.js";

import {
  migrateLegacyPollingSignals,
} from "../services/pollingIngestion.service.js";

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
        pollType: req.query?.poll_type,
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
      pollTypes: Array.isArray(req.body?.poll_types) ? req.body.poll_types : undefined,
      pollType: req.body?.poll_type,
      subject: req.body?.subject,
      pollster: req.body?.pollster,
      state: req.body?.state,
      office: req.body?.office,
      fromDate: req.body?.from_date,
      limit: req.body?.limit,
    });

    res.status(result.skipped ? 409 : 200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function migrateLegacyPollingController(_req, res, next) {
  try {
    res.json(await migrateLegacyPollingSignals());
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

