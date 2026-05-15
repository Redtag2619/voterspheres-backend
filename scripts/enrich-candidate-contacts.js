import "dotenv/config";

import {
  enrichAllCandidateProfiles,
  getCandidateContactCoverage,
} from "../services/candidateProfiles.service.js";

import pool from "../config/database.js";

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function boolArg(name, fallback = true) {
  const value = getArg(name, String(fallback));
  return String(value).toLowerCase() !== "false";
}

const limit = Number(getArg("limit", process.env.CANDIDATE_ENRICH_LIMIT || 250));
const offset = Number(getArg("offset", 0));
const state = getArg("state", null);
const office = getArg("office", null);
const onlyMissing = boolArg("only-missing", true);
const full = boolArg("full", false);

try {
  console.log("Starting candidate contact enrichment...", {
    limit,
    offset,
    state,
    office,
    onlyMissing,
    full,
    brave: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    serpapi: Boolean(process.env.SERPAPI_API_KEY),
  });

  const before = await getCandidateContactCoverage({ state, office });
  console.log("Coverage before:", before);

  const result = await enrichAllCandidateProfiles(limit, {
    offset,
    state,
    office,
    onlyMissing,
    full,
  });

  console.log("Enrichment result:", result);

  const after = await getCandidateContactCoverage({ state, office });
  console.log("Coverage after:", after);
} catch (error) {
  console.error("Candidate enrichment failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
