import "dotenv/config";
import { enrichConsultantContactsBatch } from "../services/consultantContactEnrichment.service.js";
import pool from "../config/database.js";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

async function main() {
  const limit = Number(readArg("limit", 50));
  const state = readArg("state", "");
  const dryRun = String(readArg("dry-run", "false")).toLowerCase() === "true";
  const source = readArg("source", "script_inferred_enrichment");

  console.log("Starting consultant contact enrichment...", {
    limit,
    state: state || null,
    dryRun,
    source,
  });

  const result = await enrichConsultantContactsBatch({
    limit,
    state,
    dryRun,
    source,
  });

  console.log("Consultant contact enrichment complete");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error("Consultant contact enrichment failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
