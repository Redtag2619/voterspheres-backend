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
      reason: "Unified polling ingestion is already running.",
      last_result: lastResult,
    };
  }

  running = true;

  try {
    lastResult = await runPollingIntelligenceIngestion({
      pollTypes: options.pollTypes,
      pollType: options.pollType,
      subject: options.subject,
      pollster: options.pollster,
      state: options.state,
      office: options.office,
      fromDate: options.fromDate,
      limit: Number(options.limit || process.env.VOTEHUB_SYNC_LIMIT || 500),
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

