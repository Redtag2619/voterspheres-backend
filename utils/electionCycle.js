export const MIN_FEDERAL_ELECTION_CYCLE = 2026;
export const MAX_FEDERAL_ELECTION_CYCLE = 2200;
export const DEFAULT_FEDERAL_ELECTION_CYCLE = 2026;

export class ElectionCycleValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ElectionCycleValidationError";
    this.code = "INVALID_ELECTION_CYCLE";
    this.statusCode = 400;
    this.details = details;
  }
}

export function isFederalElectionCycle(value) {
  const year = Number(value);
  return (
    Number.isInteger(year) &&
    year >= MIN_FEDERAL_ELECTION_CYCLE &&
    year <= MAX_FEDERAL_ELECTION_CYCLE &&
    year % 2 === 0
  );
}

export function normalizeFederalElectionCycle(
  value,
  { fallback = DEFAULT_FEDERAL_ELECTION_CYCLE, fieldName = "cycle" } = {}
) {
  const candidate =
    value === undefined || value === null || String(value).trim() === ""
      ? fallback
      : value;
  const year = Number(candidate);

  if (!isFederalElectionCycle(year)) {
    throw new ElectionCycleValidationError(
      `${fieldName} must be an even-numbered federal election cycle between ${MIN_FEDERAL_ELECTION_CYCLE} and ${MAX_FEDERAL_ELECTION_CYCLE}.`,
      { field: fieldName, received: value }
    );
  }

  return year;
}

export function optionalFederalElectionCycle(value, options = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  return normalizeFederalElectionCycle(value, options);
}

export function configuredFederalElectionCycle(
  value,
  { fieldName = "cycle" } = {}
) {
  return normalizeFederalElectionCycle(
    value,
    {
      fallback:
        process.env.FEC_DEFAULT_CYCLE ||
        process.env.FEC_CYCLE ||
        DEFAULT_FEDERAL_ELECTION_CYCLE,
      fieldName,
    }
  );
}

export function buildFederalElectionCycles({ startYear = 2026, count = 8 } = {}) {
  const start = normalizeFederalElectionCycle(startYear, { fieldName: "startYear" });
  const size = Math.min(Math.max(Number(count) || 8, 1), 50);
  return Array.from({ length: size }, (_, index) => start + index * 2);
}

export function sendElectionCycleError(res, error) {
  if (!(error instanceof ElectionCycleValidationError)) return false;
  res.status(error.statusCode).json({
    ok: false,
    error: error.message,

    code: error.code,
    details: error.details,
  });
  return true;
}
