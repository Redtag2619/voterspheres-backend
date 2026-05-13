import {
  enrichAllCandidateProfiles,
  getCandidateContactCoverage,
} from "./candidateProfiles.service.js";

let timer = null;
let running = false;

export function startCandidateEnrichmentScheduler() {
  const enabled =
    String(process.env.CANDIDATE_ENRICH_SCHEDULER_ENABLED || "").toLowerCase() ===
    "true";

  if (!enabled) {
    console.log("Candidate enrichment scheduler disabled.");
    return null;
  }

  const intervalMs = Number(
    process.env.CANDIDATE_ENRICH_SCHEDULER_INTERVAL_MS || 86400000
  );

  const batchSize = Number(
    process.env.CANDIDATE_ENRICH_SCHEDULER_BATCH_SIZE || 100
  );

  async function runScheduledEnrichment() {
    if (running) return;

    running = true;

    try {
      console.log("Candidate enrichment scheduler running...", {
        batchSize,
      });

      const before = await getCandidateContactCoverage();

      const result = await enrichAllCandidateProfiles(batchSize, {
        onlyMissing: true,
      });

      const after = await getCandidateContactCoverage();

      console.log("Candidate enrichment scheduler complete.", {
        before,
        result,
        after,
      });
    } catch (error) {
      console.error(
        "Candidate enrichment scheduler failed:",
        error?.message || error
      );
    } finally {
      running = false;
    }
  }

  timer = setInterval(runScheduledEnrichment, intervalMs);

  console.log(
    `Candidate enrichment scheduler enabled (${intervalMs}ms).`
  );

  if (
    String(process.env.CANDIDATE_ENRICH_RUN_ON_STARTUP || "").toLowerCase() ===
    "true"
  ) {
    setTimeout(runScheduledEnrichment, 15000);
  }

  return timer;
}

export function stopCandidateEnrichmentScheduler() {
  if (timer) {
    clearInterval(timer);
  }

  timer = null;
}
