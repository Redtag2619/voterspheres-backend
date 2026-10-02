# Polling Read Integrity

- Recalculate freshness on every dashboard read from survey field-end date using the existing score thresholds. Missing survey dates remain unknown; publication and record-update timestamps cannot make an undated survey fresh.
- Compare field-start, field-end and publication dates with the server UTC calendar date. Exclude future-dated records before the current metrics row limit; expose them separately with a warning and a bounded review list. Records stay unchanged in PostgreSQL.
- Return the total matching current answer count alongside the returned answer count and cap status. Current dashboard metrics describe the returned sample when capped; broad scope tab totals continue to describe stored records.
- Fetch one extra answer row and drop an incomplete boundary poll from metrics. Unknown-date polls remain visible and contribute to counts, but not the freshness average.
- Display cap and future-date notices in the frontend; missing survey freshness displays Unknown.

Installer preview is the default; --apply creates backups and installs. Backend must match the uploaded post-date-integrity service. Frontend uses unique text anchors and preserves other page edits. No database migrations, provider calls, dependency updates, commits or deployments.

Checks: backend syntax, polling-read-integrity, polling-date-integrity, executive-polling-evidence and executive-polling-prose; frontend polling-read-integrity, polling-date-integrity and production build. Review Git diffs before selectively staging. Keep unrelated dependencies, local configuration and backups out of the commit.

The future-date decision uses UTC calendar days; it does not claim any date has been verified. This patch diagnoses and withholds suspect dates; it does not correct provider records or schedule ingestion.
