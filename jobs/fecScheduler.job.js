import dotenv from "dotenv";
import { runFecCandidateIngestion } from "./fecCandidateIngestion.job.js";

dotenv.config();

let fecJobHandle = null;

export function startFecScheduler() {
  const disabled = String(process.env.DISABLE_FEC_CANDIDATE_JOB || "false") === "true";
  if (disabled) {
    console.log("⏸ FEC candidate ingestion job disabled");
    return;
  }

  const intervalMs = Number(process.env.FEC_CANDIDATE_INTERVAL_MS || 3600000);

  if (fecJobHandle) {
    clearInterval(fecJobHandle);
  }

  fecJobHandle = setInterval(async () => {
    try {
      const result = await runFecCandidateIngestion();
      console.log("✅ FEC candidate ingestion completed:", result);
    } catch (error) {
      console.error("❌ FEC candidate ingestion failed:", error.message || error);
    }
  }, intervalMs);

  console.log(`⏱ FEC candidate ingestion scheduled every ${intervalMs}ms`);
}
