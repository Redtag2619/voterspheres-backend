import { isFullTimelineRequest } from './planningIntegrity.js';

export function buildPlanningRepairInstructions({ prompt = '', temporalScope = {}, violations = [] } = {}) {
  const cycle = Number(temporalScope.cycle_year);
  if (!Number.isInteger(cycle)) throw new Error('Repair requires a resolved selected cycle.');
  const items = Array.isArray(violations) ? [...new Set(violations.map(String))] : [];
  return [
    `Selected election cycle: ${cycle}.`,
    `Allowed planning window: ${temporalScope.election_window_start} through ${temporalScope.election_window_end}.`,
    'Correct EACH detected validation issue below. Do not merely repeat the original draft.',
    ...items.map((issue, index) => `${index + 1}. ${issue}`),
    'Use one Markdown heading per milestone, followed by its own Owner, Timing, Actions, Metrics and Risks fields. Put each field on a separate line.',
    'Election execution, GOTV mobilization, early voting execution and post-election review must use the selected cycle year. Earlier work must be a separate preparation/training milestone.',
    'Use month-and-year timing for election milestones when an official exact date is not supplied. If keeping an exact date, put "provisional; verify with official election authorities" directly in that milestone\'s Timing field.',
    'Never claim an election date was officially verified unless the supplied context establishes it.',
    ...(isFullTimelineRequest(prompt) ? [
      `This is a FULL timeline: use distinct "Primary Election Phase" and "General Election Phase" headings.`,
      'Give campaign overview facts and numbered Actions no Timing fields; they are not election milestones.',
      'Use Primary GOTV Execution Timing: selected cycle year; pending official confirmation. Do not invent a fixed start date for primary-dependent execution. Dated staffing, training and infrastructure belong in separate Preparation milestones.',
      'Primary election and voting dates must say "pending official confirmation". Do not assign a specific day, even with a provisional label; no authoritative primary calendar is supplied.',
      `Under General Election Phase include separate headings "General-election GOTV Execution", "General-election Election Day Operations" and "General-election Post-Election Review". Each needs its own explicit ${cycle} Timing field.`,
      `General-election Election Day operations must be November ${cycle} (provisional; verify). Use month/year instead of inventing an exact date.`,
      `Schedule final general-election GOTV in the selected election year and the post-election review in December ${cycle}, after the general election. A primary GOTV action or primary Election Day cannot substitute for general-election milestones.`,
      'A phase heading or a preparation/development milestone does not satisfy election execution coverage.',
      'Replace the old phase layout with the following REQUIRED section outline. Fill each section with recommendations supported by the draft. Do not copy a conflicting heading or date from the old draft. Preserve substantive recommendations by moving early execution activities to preparation, rather than preserving their invalid dates.',
      `## Preparation Phase\nKeep ordinary preparation within the allowed planning window.\n## Primary Election Phase (pending official confirmation)\n### Primary Election Day Operations\n- Timing: ${cycle}; pending official confirmation\n- Owner: retain or assign a proposed campaign role\n- Actions: primary operations contingent on confirmed official schedule\n## General Election Phase\n### General-election GOTV Execution\n- Timing: October ${cycle} - November ${cycle} (planning assumption; voting dates pending official verification)\n- Owner: retain or assign a proposed campaign role\n- Actions: final general-election mobilization\n### General-election Election Day Operations\n- Timing: November ${cycle} (provisional; verify with official election authorities)\n- Owner: retain or assign a proposed campaign role\n- Actions: general-election operations\n### General-election Post-Election Review\n- Timing: December ${cycle}\n- Owner: retain or assign a proposed campaign role\n- Actions: evaluate general-election results`,
      'Add Risks, Metrics and Next Actions for each milestone. The outline is a planning structure, not evidence of confirmed dates, personnel, or resources. Do not put specific election dates in parent headings. Primary milestones may remain contingent; never fabricate their calendar.',

    ] : []),
    'Preserve substantive content and selected geography/office. Do not invent source evidence, official filing deadlines or primary dates. Return only the corrected deliverable.',
  ].join('\n');
}
