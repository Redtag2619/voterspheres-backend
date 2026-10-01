# Phase 2.12: Next Action Date Integrity

Requires Phase 2.11 R2. Backend-only update; the existing frontend quality panel displays the new findings. No database changes, dependency updates, external provider requests, commits or deployments.

Next Actions dates are checked with the server's strict temporal scope. Supported explicit date formats: YYYY-MM-DD, Month D YYYY, Month YYYY and Q1-Q4 YYYY (years must have four digits). Date granularity is preserved: a month or quarter overlapping the planning date is not presumed expired. Relative deadlines are not assigned fabricated dates. Ambiguous formats, bare years and implicit inherited years are not parsed. The checker compares local milestone fields; it does not establish an official election calendar.

Findings flag invalid calendar dates, deadlines entirely before the planning date or after the selected cycle, deadlines after a milestone's Timing window, and review/debrief deadlines preceding the declared post-election review window. Early recruitment or logistics may support a later execution milestone. Explicit venue booking alone may occur before review; it cannot exempt early results analysis or debrief work.

The supplied defect is covered: December 2029 debrief under December 2030 General-election Post-Election Review. Proposed roles, metrics and calendar assumptions remain assumptions. Findings remain advisory in deliverable_quality; no new rejection gate or automatic date rewriting is introduced. Calendar validation still runs separately.

Quality assessment now also covers requests explicitly labeled strategy, plan or GOTV when the response contains Markdown milestone headings and Timing fields. Ordinary summaries remain outside this assessment. Generic contingent primary action text is recognized even with a bullet prefix. The generator receives date-ordering instructions through existing initial-generation and calendar-repair instruction paths. Advisory-only findings do not trigger an additional provider request.

Run scripts/installNextActionIntegrity.mjs from the backend repository, first in preview, then with --apply. Reviewed source fingerprints prevent accidental overwrites. Existing dependencies and scripts are preserved; only test:next-action-integrity is added to package.json. Backups are written before apply; failed writes roll back.

Verify with check:syntax, test:next-action-integrity, test:deliverable-quality and existing planning/election-phase regression suites. Restart the running local backend while keeping its current CORS environment. Generate a NEW response: old saved quality metadata is not recalculated.
