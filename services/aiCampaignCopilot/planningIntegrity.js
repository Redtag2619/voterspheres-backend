const EXECUTION = /\b(election[- ]day|gotv|get[- ]out[- ]the[- ]vote|early voting (?:outreach|mobilization)|post[- ]election (?:analysis|reporting))\b/i;
const PREPARATION = /\b(preparation|prepare|planning|plan|rehearsal|training|design|develop|development|draft)\b/i;
const YEAR = /\b(20\d{2}|21\d{2}|2200)\b/g;
const EXACT_DATE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(?:20\d{2}|21\d{2}|2200)\b|\b(?:20\d{2}|21\d{2}|2200)-\d{2}-\d{2}\b/i;
const LABEL = /\b(?:unverified|provisional|verify|to be confirmed|requires verification)\b/i;

export function parsePlanningMilestones(answer = '') {
  // Give each field and numbered/decimal action a boundary even in flattened Markdown.
  const text = String(answer).replace(/\r\n/g, '\n')
    .replace(/[ \t]+(?=#{1,6}\s)/g, '\n')
    .replace(/[ \t]+(?=\d+(?:\.\d+)*\.\s+[A-Z*])/g, '\n')
    .replace(/[ \t]+(?=-\s*\*{0,2}(?:Owner|Priority|Timing|Actions|Next Actions|Risks|Metrics)\b)/gi, '\n');
  const blocks = text.split(/\n(?=\s*#{1,6}\s+(?!(?:Timing|Priority|Owner|Risks|Metrics|Next Actions|Actions)\b))|\n(?=\s*\d+(?:\.\d+)*\.\s)/i);
  return blocks.map(block => {
    const lines = block.split('\n');
    const title = lines[0].replace(/[#*]/g, '').replace(/^\s*\d+(?:\.\d+)*\.\s*/, '').trim();
    const timingParts = [];
    for (let i = 1; i < lines.length; i++) {
      const hit = lines[i].match(/^\s*(?:-\s*)?(?:#{1,6}\s*)?\*{0,2}Timing\s*:?\*{0,2}\s*:?\s*(.*)$/i);
      if (!hit) continue;
      if (hit[1].trim()) timingParts.push(hit[1].trim());
      else if (i + 1 < lines.length && !/^\s*(?:-\s*|#{1,6}\s*)?\*{0,2}(?:Owner|Priority|Actions|Next Actions|Risks|Metrics)\b/i.test(lines[i+1])) timingParts.push(lines[++i].trim());
    }
    const timing = timingParts.join(' ') || (/\bphase\b/i.test(title) ? '' : title);
    return { title, timing, preparation: PREPARATION.test(title) && !/\b(?:execute|execution|mobilization|deployment)\b/i.test(title) };
  }).filter(item => item.title);
}

export function electionMilestoneViolations(answer = '', scope = {}) {
  if (!scope.strict_temporal) return [];
  const cycle = Number(scope.cycle_year);
  if (!Number.isInteger(cycle)) return ['Selected election year is missing'];
  const issues = [];
  for (const {title,timing,preparation} of parsePlanningMilestones(answer)) {
    if (preparation || !EXECUTION.test(title + ' ' + timing)) continue;
    const years = [...timing.matchAll(YEAR)].map(m => Number(m[1]));
    if (years.some(year => year !== cycle)) issues.push(`Election execution must use selected cycle ${cycle}: ${title}; timing: ${timing}`);
    // A verification label on this milestone's title or Timing is valid, never a neighboring milestone.
    if (EXACT_DATE.test(timing) && !LABEL.test(title + ' ' + timing)) issues.push(`Exact election milestone dates require an explicit provisional or verification label (${title}; timing: ${timing})`);
  }
  return [...new Set(issues)];
}

export function withCycleEvidenceAssessment(answer = '', evidence) {
  if (!evidence) return String(answer);
  const lines = String(answer).split(/\r?\n/);
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*(?:#{1,6}\s*)?(?:\*\*)?cycle evidence assessment(?:\*\*)?\s*:?/i.test(line)) {
      kept.push(line); continue;
    }
    // A standalone assessment heading owns its paragraphs until the next heading.
    const standalone = /^\s*(?:#{1,6}\s*)?(?:\*\*)?cycle evidence assessment(?:\*\*)?\s*:?\s*$/i.test(line);
    if (standalone) {
      while (i + 1 < lines.length && !/^\s*#{1,6}\s+/.test(lines[i + 1])) i++;
    }
  }
  const assessment = evidence.matched_records
    ? 'Selected-cycle platform context is available; records without matching cycle metadata are excluded.'
    : 'No verified platform context with explicit metadata for the selected cycle is available. This plan uses assumptions rather than verified future-cycle evidence.';
  return kept.join('\n').trimEnd() + '\n\nCycle evidence assessment: ' + assessment + ' Shared donors, vendors and CRM remain operational context.';
}

export function isFullTimelineRequest(prompt = '') {
  const text = String(prompt).toLowerCase().replace(/[-–—]/g, ' ');
  return /\b(full|complete|comprehensive|end to end)\b/.test(text) && /\b(timeline|calendar|schedule)\b/.test(text)
    || /\b(timeline|calendar|schedule)\b/.test(text) && /\bgotv\b/.test(text) && /\belection day\b/.test(text);
}
export function timelineCompletenessViolations(answer = '', prompt = '', scope = {}) {
  if (!scope.strict_temporal || !isFullTimelineRequest(prompt)) return [];
  const cycle = Number(scope.cycle_year);
  let gotv = false, electionDay = false;
  for (const {title,timing,preparation} of parsePlanningMilestones(answer)) {
    if (preparation) continue;
    const years = [...timing.matchAll(YEAR)].map(m => Number(m[1]));
    if (!years.length || years.some(year => year !== cycle)) continue;
    if (/\b(gotv|get[- ]out[- ]the[- ]vote)\b/i.test(title)) gotv = true;
    if (/\belection[- ]day (?:operations|execution|deployment|logistics)\b/i.test(title)) electionDay = true;
  }
  return [
    ...(!gotv ? [`Full timeline requires an explicit GOTV execution milestone dated in ${cycle}; preparation alone is insufficient`] : []),
    ...(!electionDay ? [`Full timeline requires an explicit Election Day operations milestone dated in ${cycle}; label exact dates provisional pending verification`] : []),
  ];
}
