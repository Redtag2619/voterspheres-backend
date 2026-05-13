import "dotenv/config";

import {
  enrichAllCandidateProfiles,
  getCandidateContactCoverage,
} from "../services/candidateProfiles.service.js";

import pool from "../config/database.js";

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;

  const hit = process.argv.find((arg) =>
    arg.startsWith(prefix)
  );

  return hit ? hit.slice(prefix.length) : fallback;
}

const limit = Number(
  getArg(
    "limit",
    process.env.CANDIDATE_ENRICH_LIMIT || 100
  )
);

const offset = Number(
  getArg("offset", 0)
);

const onlyMissing =
  String(
    getArg("only-missing", "true")
  ).toLowerCase() !== "false";

try {
  console.log("Starting scheduled candidate enrichment...", {
    limit,
    offset,
    onlyMissing,
    maxPages:
      process.env.CANDIDATE_ENRICH_MAX_PAGES || 10,
    brave:
      Boolean(process.env.BRAVE_SEARCH_API_KEY),
    serpapi:
      Boolean(process.env.SERPAPI_API_KEY),
  });

  const before =
    await getCandidateContactCoverage();

  console.log("Coverage before:", before);

  const result =
    await enrichAllCandidateProfiles(limit, {
      offset,
      onlyMissing,
    });

  console.log("Enrichment result:", result);

  const after =
    await getCandidateContactCoverage();

  console.log("Coverage after:", after);
} catch (error) {
  console.error(
    "Scheduled candidate enrichment failed:",
    error
  );

  process.exitCode = 1;
} finally {
  await pool.end();
}
