# Phase 2.9.1 — Deterministic briefing prose integration

Completes the candidate-answer layer of Phase 2.9 using the orchestrator source uploaded September 30. Changes only its candidate answer builder: adds the filtered polling evidence assessment to answer, labels stale polling as historical and unknown freshness explicitly, lists continuous tracking counts separately, and recognizes valid zero-match results without raw source_result. Provider errors remain degraded. Other finance, news, strategy, auth and routing code is preserved.

Revised installer R2 patches three validated locations in the current candidate-answer builder. It preserves all text outside that builder and stops on missing/duplicated integration points or an already-installed marker. It syntax-checks the patched file before changing application files. Backup contains the actual local orchestrator and package.json. Existing Phase 2.9 bundle/helper are preserved. The new contract tests execute the actual installed candidate-answer function with isolated fixtures. They do not test live auth, external providers or OpenAI synthesis.

The two pasted source versions differed only by an extra trailing blank line. Their comparison did not establish the actual local file mismatch. R2 avoids whole-file replacement and tolerates formatting around the three checked hooks.

After extraction, locate scripts/installExecutivePollingProse.mjs recursively and run node installer from the backend root, first preview then --apply. Run npm run check:syntax, npm run test:executive-polling-prose, npm run test:executive-polling-evidence, npm run test:tenant-isolation and git diff --check. The prose suite has seven checks.

Start/restart the local backend with npm run start:clean in another PowerShell window. POST the existing authenticated Jasmine Crockett TX House district 30 cycle 2026 request to /api/executive-intelligence-orchestrator/brief. Inspect result.answer and result.data_answer.answer (and corresponding nested briefing fields if your API wraps them). Expected: Polling evidence assessment, 0 direct House polling, historical candidate-context records, explicit stale age from survey dates. The smoke test's 212-day age is time-dependent; do not hard-code it as an assertion. Structured polling.evidence_version should remain 2.9.0.

The model-generated executive summary may paraphrase structured evidence. This patch directly changes the deterministic candidate data answer; live endpoint output still needs verification. Regular-user 14-check validation and optional platform-operator validation remain separate. No role upgrade is included. The political_signals_news missing-description warning is a separate schema/query problem requiring the current query and table columns; no guessed migration is included.

Stage only the intended Phase 2.9 and 2.9.1 services, tests, guides and package.json after reviewing diffs. Do not stage backups or diagnostics. Commit and push through the established backend workflow, then verify Render's active commit and repeat the endpoint smoke check. No frontend deploy is required.

Rollback: restore the two originals from the printed backup and remove the new prose test/guide, or revert the reviewed commit if committed. No data rollback is required. Preserve Phase 2.8 baseline and diagnostics.
