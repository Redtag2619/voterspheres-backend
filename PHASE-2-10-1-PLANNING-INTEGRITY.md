# Phase 2.10.1: Planning integrity

Backend-only follow-up to Phase 2.10. The existing year-window guard remains. Markdown action blocks and explicit election-execution sentences now also check election-year alignment. Earlier training, design and rehearsal can remain preparation. Exact Election Day milestone dates must carry a provisional/verification label; this is not official date verification.

Generation and repair instructions specify the selected cycle. One repair is attempted by the existing pipeline; if detected violations remain, the existing TEMPORAL_SCOPE_VIOLATION response (422) blocks the answer. Responses without strict_temporal preserve existing behavior. This is a targeted text guard, not a proof of correctness for arbitrary prose, election law, or all campaign timelines. Undated execution milestones and implicit phrasing still need review.

The backend canonical cycle-evidence assessment is attached after repair. Existing assessment headings/paragraphs are replaced. Later Markdown sections are preserved. The evidence policy and immutable selected-cycle context filtering from Phase 2.10 remain.

Installer default is preview. Run from backend root; use --apply after preview. Unique source anchors reject incompatible source. Originals are backed up. Existing scripts and dependency edits are preserved. No frontend changes, database operations, provider calls or deployments occur during installation.

Commands:

    node <extracted-package>\scripts\installPlanningIntegrity.mjs
    node <extracted-package>\scripts\installPlanningIntegrity.mjs --apply
    npm run check:syntax
    npm run test:planning-integrity
    npm run test:future-cycle-evidence
    npm run test:tenant-isolation
    npm run test:executive-polling-evidence
    npm run test:executive-polling-prose
    git diff --check

Run a new authenticated 2030 request with strict temporal mode. Review that execution uses 2030, earlier activities are preparation, provisional dates are marked, and assessment occurs once. Test again after deployment. Render Live at Phase 2.10 remains unconfirmed from supplied logs. Preserve uncommitted Nodemailer and lockfile edits separately when staging.
