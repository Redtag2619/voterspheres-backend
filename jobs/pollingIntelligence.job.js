
import {
  runPollingIntelligenceIngestion,
} from "../services/pollingIntelligence.service.js";

let running = false;
let lastResult = null;

export async function runPollingIntelligenceJob(options = {}) {
  if (running) {
    return {
      ok: false,
      skipped: true,
      reason: "Polling Intelligence ingestion is already running.",
      last_result: lastResult,
    };
  }

  running = true;

  try {
    lastResult = await runPollingIntelligenceIngestion({
      includeHistorical:
        options.includeHistorical ??
        String(process.env.POLLING_INCLUDE_HISTORICAL || "false").toLowerCase() === "true",

      generateEstimates:
        options.generateEstimates ??
        String(process.env.POLLING_GENERATE_ESTIMATES || "true").toLowerCase() !== "false",

      estimateCycle:
        Number(
          options.estimateCycle ||
          process.env.POLLING_ESTIMATE_CYCLE ||
          new Date().getFullYear()
        ),

      lookbackDays:
        Number(
          options.lookbackDays ||
          process.env.POLLING_LOOKBACK_DAYS ||
          730
        ),

      retentionDays:
        Number(
          options.retentionDays ||
          process.env.POLLING_RETENTION_DAYS ||
          3650
        ),
    });

    return lastResult;
  } finally {
    running = false;
  }
}

export function getPollingIntelligenceJobStatus() {
  return {
    ok: true,
    running,
    last_result: lastResult,
    checked_at: new Date().toISOString(),
  };
}

export default runPollingIntelligenceJob;

