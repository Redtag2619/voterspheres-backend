# VoterSpheres Phase 2.6 rollback checklist

Phase 2.6 is read-only. The validator itself does not require a database rollback.

## Stop conditions

- Any public-user request exposes `unresolved` or `all`.
- Election polling returns continuous-tracking records, or the reverse.
- A continuous-tracking request accepts an election-cycle filter.
- Scope counts differ between the beginning and end of validation.
- Render or Vercel health checks fail after deployment.

## Backend rollback (Render)

1. Stop validation and retain its JSON report.
2. In Render, redeploy the deployment immediately preceding backend commit `124d7a2`.
3. Confirm `/api/health` returns HTTP 200.
4. Confirm authenticated legacy election-polling reads work.
5. Do not run a database migration or reverse the Phase 2.2 remediation; Phase 2.5 and Phase 2.6 add no migration.

## Frontend rollback (Vercel)

1. Promote the Vercel deployment immediately preceding frontend commit `b089f56`.
2. Confirm login and the Executive Polling Intelligence page load.
3. Confirm the frontend no longer sends unsupported temporal-scope queries to a rolled-back backend.

## Recovery evidence

- Render deployment identifier and timestamp.
- Vercel deployment identifier and timestamp.
- `/api/health` result.
- Phase 2.6 JSON validation report.
- Before/after polling scope-count hashes.
