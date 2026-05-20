import { importConsultantsFromFec } from "../services/consultantImport.service.js";
import { scoreConsultantRisk } from "../services/consultantRisk.service.js";

let timer = null;
let running = false;

export function startConsultantImportJob() {
  const enabled =
    String(process.env.CONSULTANT_IMPORT_JOB_ENABLED || "").toLowerCase() === "true";

  if (!enabled) {
    console.log("Consultant import job disabled.");
    return null;
  }

  const intervalMs = Math.max(
    60 * 60 * 1000,
    Number(process.env.CONSULTANT_IMPORT_JOB_INTERVAL_MS || 6 * 60 * 60 * 1000)
  );

  const cycle = Number(process.env.FEC_DEFAULT_CYCLE || 2026);
  const candidateLimit = Number(process.env.CONSULTANT_IMPORT_JOB_CANDIDATE_LIMIT || 100);
  const maxPages = Number(process.env.CONSULTANT_IMPORT_JOB_MAX_PAGES || 2);

  async function runJob() {
    if (running) return;
    running = true;

    try {
      console.log("Consultant import job running...", {
        cycle,
        candidateLimit,
        maxPages,
      });

      const importResult = await importConsultantsFromFec({
        cycle,
        candidateLimit,
        maxPages,
        dryRun: false,
      });

      const riskResult = await scoreConsultantRisk({ cycle });

      console.log("Consultant import job complete.", {
        importResult,
        riskResult,
      });
    } catch (error) {
      console.error("Consultant import job failed:", error?.message || error);
    } finally {
      running = false;
    }
  }

  timer = setInterval(runJob, intervalMs);

  console.log(`Consultant import job enabled (${intervalMs}ms).`);

  if (
    String(process.env.CONSULTANT_IMPORT_JOB_RUN_ON_STARTUP || "").toLowerCase() === "true"
  ) {
    setTimeout(runJob, 20000);
  }

  return timer;
}

export function stopConsultantImportJob() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
