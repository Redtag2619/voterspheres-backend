# Phase 2.10.3 R3 — Explicit full-timeline repair outline

The attached diagnostic established that the repaired model draft retained the old phase layout, started GOTV in 2029 for cycle 2030, omitted primary/general phase ownership, and used an incorrect exact general-election date. The checks correctly withheld it.

R3 provides the existing repair call with a required section outline: preparation; primary election pending official confirmation; general election with explicit general-election GOTV, November Election Day operations, and December review. It tells repair to relocate early execution recommendations into preparation and to use month/year general-election timing rather than inventing an exact day. The outline is a planning structure, not verified personnel, resources, or primary calendar evidence.

The general-election guard additionally checks exact dates against the congressional statutory November date (2 USC 7): https://uscode.house.gov/view.xhtml?edition=prelim&req=granuleid%3AUSC-prelim-title2-section7 . The existing requirement to label exact election dates for verification remains. Primary dates remain pending; a provisional label cannot establish an unknown primary schedule.

Requires the installed R2 helpers. The installer checks fingerprints of those two helpers, previews changes, backs up replacements and preserves package dependencies/scripts. It does not overwrite the service or local debug instrumentation. No frontend, database, provider, role, commit or deployment operations occur. One model repair attempt remains; a stochastic model can still fail and is never replaced with a fabricated success.

Run scripts/installElectionPhaseIntegrity.mjs from the backend repository, first for preview, then with --apply. Run check:syntax, test:election-phase-integrity-r3, test:election-phase-integrity-r2, test:election-phase-integrity, test:planning-integrity, test:copilot-generation-feedback, test:future-cycle-evidence, test:tenant-isolation and git diff --check. Restart the backend in its existing terminal to preserve localhost CORS and debug environment. Generate the complete 2030 timeline again. If invalid output remains, supply the rejectedAnswer diagnostic instead of only the browser error.

The automated tests mock model calls and include the actual attached rejected draft; live generation still requires the user's environment.
