# Phase 2.11 R2: Inline fields and preparation review

Requires the installed Phase 2.11 package. Run the matching installer from each repository, first in preview mode, then with --apply. Source fingerprints prevent overwriting changes; the installer backs up changed files and rolls back on write failure. No database changes, dependency updates, provider requests, commits or deployments.

Inline bold Owner, Priority, Timing, Actions, Risks, Metrics and Next Actions labels now start separate lines in backend output and frontend display. Fenced code is preserved. Existing dashed fields retain their list syntax. Saved responses receive display normalization, but their saved quality metadata is not recomputed; generate a new response to verify updated findings.

Preparation blocks with individual Timing fields are assessed. Six or more numbered actions under a single preparation block trigger an advisory to split workstreams into separately owned and dated milestones. Phase containers without timing fields are not milestones. This is a structural heuristic, not an assessment of campaign effectiveness.

Primary operations with fixed ISO or month/day/year dates in Timing or Next Actions are flagged while primary timing is pending official confirmation. Use briefing/readiness deadlines relative to the confirmed schedule. Ordinary dated primary research/preparation is not flagged as election operations. Findings remain advisory and do not introduce another rejection gate.

Regression tests include the supplied response (answer text only), inline field recognition, preparation review, unsupported primary briefing dates, relative deadlines, code preservation and idempotence. Existing evidence, persistence and frontend rendering contracts remain in the test suites.
