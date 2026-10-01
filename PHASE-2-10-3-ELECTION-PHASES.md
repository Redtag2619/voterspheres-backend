# Phase 2.10.3 — Primary and general-election completeness

Full strict campaign timelines require distinct primary and general-election phases. Primary voting and election timing must say "pending official confirmation" without assigning an invented day or month. The current generation boundary receives no authoritative primary calendar, so a provisional label does not validate such a date. Ordinary dated primary preparation can remain.

General-election milestones must include dated election-year GOTV execution, November Election Day operations, and a review after the general election. Primary milestones cannot satisfy general-election completeness. Heading hierarchy and explicit milestone titles determine phase ownership; a sibling phase cannot inherit an unrelated phase label. Use explicit general-election titles for flattened numbered output.

Repair receives these failures in the existing single repair attempt. All original cycle, temporal and completeness checks remain. Invalid repairs still return 422 with visible Studio feedback. No frontend changes or new model calls are introduced.

The congressional general-election November anchor and the first Tuesday after the first Monday used for review ordering follow 2 USC 7: https://uscode.house.gov/view.xhtml?edition=prelim&req=granuleid%3AUSC-prelim-title2-section7 . This calendar calculation is not verification of state primary, early-voting, filing, or polling-place schedules. Exact election milestones retain the existing provisional/verification requirement.

## Install and verify
Requires the reviewed Phase 2.10.2 backend service and repair instructions plus the R4 planningIntegrity.js. The installer checks normalized fingerprints, previews all changes, backs up overwritten files, preserves dependencies/scripts, and restores files after write failure. A source mismatch stops before writing; provide current files rather than bypassing it.

Run from the backend repository:
node <package>/scripts/installElectionPhaseIntegrity.mjs
node <package>/scripts/installElectionPhaseIntegrity.mjs --apply
npm run check:syntax
npm run test:election-phase-integrity
npm run test:planning-integrity
npm run test:copilot-generation-feedback
npm run test:future-cycle-evidence
npm run test:tenant-isolation
npm run test:executive-polling-evidence
npm run test:executive-polling-prose
git diff --check

Restart the running local backend in the same terminal with the existing localhost CORS environment preserved. Then generate a complete 2030 timeline. Expected: pending primary dates; distinct general-election GOTV and November Election Day operations; December 2030 review. An incomplete model draft stays withheld and receives one repair attempt. These tests mock model calls; live generation requires the user's environment.

No database operations, dependency updates, provider requests, commits, activation changes or deployments are performed.
