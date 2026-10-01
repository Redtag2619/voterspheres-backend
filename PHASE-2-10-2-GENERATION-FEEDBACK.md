# Phase 2.10.2 — Generation feedback and repair

Repair receives the actual calendar validation failures, selected cycle, and planning window. Instructions require distinct milestone headings and their own timing fields, dated election-year GOTV execution and Election Day operations for full timelines, and local provisional labels for exact election dates. The existing single repair attempt and final calendar validation remain in place. Invalid output stays withheld.

The authenticated ask route returns HTTP 422 with the remaining violations and selected cycle. Unexpected failures remain HTTP 500.

Studio keeps generation failures beside the conversation or asset controls, independently of session refreshes. Empty replies display an error rather than a fabricated answer. Replies and failures from an earlier campaign scope are discarded.

## Install
Run each side's installer from its repository, first without arguments for preview, then with --apply. Installers check normalized fingerprints of the supplied current source before making changes, back up replaced files, preserve package dependencies and existing scripts, and restore files if a write fails. Backend requires the reviewed R4 planningIntegrity.js and does not replace it. Frontend updates the existing future-cycle test harness to account for persistent error state and suppression of stale-scope errors.

Backend checks: check:syntax, test:planning-integrity, test:copilot-generation-feedback, test:future-cycle-evidence, test:tenant-isolation, test:executive-polling-evidence, test:executive-polling-prose. Frontend checks: test:copilot-generation-feedback-ui, test:future-cycle-ui, test:polling-temporal-scope-ui, build. Run git diff --check on each side.

## Local restart and acceptance
Keep the backend and Vite running in separate terminals. For local backend testing add http://localhost:5173 to the process's ADDITIONAL_ALLOWED_ORIGINS, preserving any existing entries, before npm run start:clean. Ensure Vite uses the local backend API and restart it if environment values changed. Do not change Render settings or production origins for this local test.

Generate the full 2030 timeline again. A valid reply must contain dated 2030 GOTV execution and Election Day operations and label exact election dates provisional. If repair still fails, Studio must show the 422 explanation beside the output; no invalid calendar is returned. No guarantee is made that a stochastic model will always produce a valid answer. The automated tests mock model/network calls; live generation and the frontend Vite build require the user's repositories and environment.

No database changes, dependency updates, provider requests, commits or deployments are performed by this installer.
