# Phase 2.12.1: Calendar Field Integrity

Backend-only fix for inline calendar parsing and kickoff-meeting classification. The reported error contains real wrong-year GOTV execution and post-election analysis alongside a false election-date warning for an earlier kickoff meeting.

The calendar parser now separates plain and bold inline Owner, Timing, Actions, Metrics, Risks and Next Actions fields. A kickoff/planning/coordination meeting explicitly titled Schedule, Organize, Hold, Conduct or Arrange is preparation even when its subject mentions GOTV execution. This exception does not apply to adjacent execution milestones or unlabeled execution kickoff. Wrong-year execution, primary date restrictions, phase completeness and exact election-date verification requirements remain enforced.

Repair instructions now explicitly distinguish kickoff meetings from actual execution and use selected-cycle examples for general GOTV, Election Day and post-election review. These examples are planning assumptions, not official calendar evidence. Primary timing remains pending official confirmation. Persistent invalid repair still returns a validation error; the update does not promise that a model draft always passes or suppress real violations.

The installer accepts reviewed old and quality-enhanced repair-helper versions and preserves existing quality imports/instructions. It does not replace aiCampaignCopilot.service.js or remove Phase 2.11/2.12 work. The supplied service attachment predates the Phase 2.11 quality imports; this patch cannot establish which source is currently running. New-response evidence_transparency and deliverable_quality metadata identify whether those later changes are active.

Run scripts/installCalendarFieldIntegrity.mjs from the backend repository, first without --apply, then with --apply. Source hashes guard reviewed parser, repair helper and phase guard. No database changes, dependency upgrades, provider requests, commits or deployments. Original files are backed up; write failures roll back. Only test:calendar-field-integrity is added to package.json; existing dependencies and scripts are retained.

Verify check:syntax, test:calendar-field-integrity, test:planning-integrity and all three election-phase suites. If installed, also run deliverable-quality and next-action-integrity. Restart the existing local backend terminal so its localhost CORS setting is retained. No frontend change is required.
