import "dotenv/config";

import {
  enrichAllCandidateProfiles,
  getCandidateContactCoverage,
} from "../services/candidateProfiles.service.js";

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

try {
  console.log(
    "Starting candidate enrichment..."
  );

  const before =
    await getCandidateContactCoverage();

  console.log("Coverage before:", before);

  const result =
    await enrichAllCandidateProfiles(limit);

  console.log("Enrichment result:", result);

  const after =
    await getCandidateContactCoverage();

  console.log("Coverage after:", after);

  process.exit(0);
} catch (error) {
  console.error(
    "Candidate enrichment failed:",
    error
  );

  process.exit(1);
}
