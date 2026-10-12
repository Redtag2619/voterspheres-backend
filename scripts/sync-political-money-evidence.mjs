import "dotenv/config";
import pool from "../config/database.js";
import {
  rebuildPoliticalMoneyScores,
  syncFecIndependentExpenditures,
} from "../services/politicalMoneyEvidence.service.js";

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const cycle = Number(argument("cycle", process.env.FEC_DEFAULT_CYCLE || 2026));
const maxPages = Number(argument("max-pages", process.env.POLITICAL_MONEY_FEC_MAX_PAGES || 3));
const perPage = Number(argument("per-page", 100));
const pauseMs = Number(argument("pause-ms", 350));
const scoresOnly = String(argument("scores-only", "false")).toLowerCase() === "true";

try {
  if (!process.argv.includes("--apply")) { console.log(JSON.stringify({mode:"preview",cycle,maxPages,scoresOnly,policy:"No provider requests or writes. Add --apply only after migration."})); } else {
  const result = scoresOnly
    ? await rebuildPoliticalMoneyScores({ cycle })
    : await syncFecIndependentExpenditures({ cycle, maxPages, perPage, pauseMs });
  console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ok:false,code:error.code||"MONEY_IMPORT_FAILED",provider_status:error.providerStatus||null}));
  process.exitCode = 1;
} finally {
  await pool.end();
}

