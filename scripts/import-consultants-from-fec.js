import "dotenv/config";
import pool from "../config/database.js";
import { importConsultantsFromFec } from "../services/consultantImport.service.js";

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function boolArg(name, fallback = false) {
  const value = getArg(name, String(fallback));
  return String(value).toLowerCase() === "true";
}

async function main() {
  const options = {
    cycle: Number(getArg("cycle", process.env.FEC_DEFAULT_CYCLE || 2026)),
    candidateLimit: Number(getArg("candidate-limit", 25)),
    offset: Number(getArg("offset", 0)),
    maxPages: Number(getArg("max-pages", process.env.FEC_CONSULTANT_IMPORT_MAX_PAGES || 3)),
    dryRun: boolArg("dry-run", false),
    state: getArg("state", null),
    office: getArg("office", null),
  };

  console.log("Starting live FEC consultant import...", {
    ...options,
    fec_api_key: Boolean(process.env.FEC_API_KEY),
  });

  const result = await importConsultantsFromFec(options);

  console.log("✅ Consultant import complete");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error("❌ Consultant import failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
run();

0fc9c66 (build live fec consultant intelligence engine)
