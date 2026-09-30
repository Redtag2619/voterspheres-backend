# FEC sync guard v1

A committee or Schedule A error previously became an empty PAC array. This patch propagates those errors through normalization before replacement writes. A 429 causes the current run to stop at its first failed request, without retries or further PAC requests. The existing CLI catches the exception and exits 1. A returned non-success result also exits 1.

Skipped PAC lookups retain same-cycle prior PAC fields, under a row lock in the replacement transaction. Their status is preserved_not_refreshed, and prior PAC evidence timestamps are retained; unknown legacy timestamps remain null. A candidate without previous PAC evidence remains skipped_limit without an invented zero total. Source row timestamps still refer to the newly fetched fundraising record, not PAC freshness.

Successful PAC responses remain limited to existing configured committee/page/result limits; retrieved_limited does not mean exhaustive coverage. The job summary exposes pac_skipped_candidates and completed_with_skipped_pac. Existing pac_synced_candidates still counts candidates with nonempty newly retrieved PAC arrays, not all successful lookups.

No schema, dependencies, polling, auth, or role changes. No production operations are performed by installation or tests. This patch cannot restore evidence already overwritten. Take a database backup and compare known retained historical evidence before resuming ingestion. Concurrent scheduled/manual syncs should not overlap; this patch does not add a cross-process job lock or repair the existing candidate-only table key.

## Install
From the backend repository, run node <installer-path> to preview, then node <installer-path> --apply. The installer refuses different service source (ignoring line endings, blank lines and trailing spaces) and preserves current package dependencies. Backups contain the original service, sync caller and package.json.

Run npm run check:syntax, npm run test:fec-sync-guard and the existing polling/tenant suites. Tests use mocked HTTP and database clients; no real database or provider is contacted. Run git diff --check and review the staged diff before commit.

Keep FEC cron suspended until reviewed changes are deployed to the cron service. The backend web service and cron may have independent deployments. Confirm the cron start command and commit before resuming. Do not use npm run sync:fec as a test: it writes data. Confirm FEC_API_KEY privately on the cron itself. A successful process exit alone is not proof of exhaustive PAC or candidate-contact coverage; candidate contact sync remains the pre-existing placeholder.

## Rollback
Keep cron suspended. Copy services/fec.service.js, scripts/syncFecData.js and package.json from the displayed backup back to their corresponding paths. Remove only the new tests/fecSyncGuard.contract.test.mjs and FEC-SYNC-GUARD.md files. The backup package.json includes any dependency changes that existed at installation. Rollback restores code only, not data. Re-run syntax checks before using restored code.
