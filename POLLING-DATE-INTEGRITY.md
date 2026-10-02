# Polling Date Integrity

The supplied backend grouped polls using String(Date).localeCompare(), which orders weekday names rather than calendar dates. The summary then read the first poll, trend buckets inherited that order, and averages took the first window. This patch normalizes date values to YYYY-MM-DD, sorts grouped polls newest first, calculates the latest date independently, orders trends oldest first, and explicitly sorts average windows. Pollster summaries and scope summaries use canonical dates.

The frontend formatter now accepts ISO dates, timestamps and legacy Date strings and formats the calendar key in UTC, avoiding raw weekday strings and local timezone display shifts. Malformed or absent dates remain missing instead of being invented.

Run scripts/installPollingDateIntegrity.mjs from each repository root, first for preview, then with --apply. It detects backend/frontend from package.json, verifies the supplied source fingerprint, backs up changed files, preserves dependency versions and existing scripts, and adds test:polling-date-integrity. Repeated installations fail without changes. No database writes, ingestion, filter changes, provider calls, commits or deployment are performed.

12 contracts pass (9 backend, 3 frontend), including actual service grouping, summary, averages, trend and pollster functions and the actual frontend formatter. Checked under UTC and America/Chicago. Tests use supplied-file fixtures, not a live database. A corrected latest date may still be in 2025 if stored data is stale; this patch does not fetch new polls. Existing ingestion freshness scores and global dashboard freshness are outside this patch.

After installation run backend syntax checks and polling regressions, frontend tests and npm run build. Inspect the actual polling response and page. Latest Poll must agree with the newest scoped available record; recent polls descend and trend dates ascend. Missing 2026 records require a separate ingestion audit after verifying these dates.
