import { getFundraisingLeaderboard } from "./intelligence.service.js";
import { syncFundraisingFromFec } from "./fec.service.js";

function n(value) {
  return Number(value || 0);
}

function money(value) {
  return `$${n(value).toLocaleString()}`;
}

function percent(part, whole) {
  return whole > 0 ? Math.round((n(part) / n(whole)) * 100) : 0;
}

function groupBy(rows, key) {
  const map = new Map();

  for (const row of rows) {
    const name = row[key] || "N/A";

    if (!map.has(name)) {
      map.set(name, {
        name,
        [key]: name,
        total_receipts: 0,
        total_cash_on_hand: 0,
        candidate_count: 0,
        pac_total: 0,
      });
    }

    const item = map.get(name);
    item.total_receipts += n(row.receipts);
    item.total_cash_on_hand += n(row.cash_on_hand);
    item.pac_total += n(row.pac_total);
    item.candidate_count += 1;
  }

  return Array.from(map.values()).sort(
    (a, b) => b.total_receipts - a.total_receipts
  );
}

function flattenPacs(candidates = []) {
  const map = new Map();

  for (const candidate of candidates) {
    for (const pac of candidate.pac_contributions || []) {
      const key = pac.committee_id || pac.committee_name;
      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, {
          committee_id: pac.committee_id || "N/A",
          committee_name: pac.committee_name || "Unknown PAC / Committee",
          committee_type: pac.committee_type || "Committee",
          committee_party: pac.committee_party || "N/A",
          total_amount: 0,
          candidate_count: 0,
          state_count: 0,
          states: new Set(),
          candidates: [],
        });
      }

      const item = map.get(key);
      item.total_amount += n(pac.amount);
      item.candidate_count += 1;
      item.states.add(candidate.state || "N/A");
      item.candidates.push({
        candidate_id: candidate.candidate_id,
        name: candidate.name,
        state: candidate.state,
        office: candidate.office,
        party: candidate.party,
        amount: n(pac.amount),
      });
    }
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      state_count: item.states.size,
      states: Array.from(item.states).sort(),
      candidates: item.candidates.sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => b.total_amount - a.total_amount);
}

function normalizeCandidate(row = {}, index = 0) {
  const pacs = Array.isArray(row.pac_contributions) ? row.pac_contributions : [];
  const pacTotal = pacs.reduce((sum, pac) => sum + n(pac.amount), 0);
  const receipts = n(row.receipts);

  return {
    ...row,
    rank: index + 1,
    receipts,
    cash_on_hand: n(row.cash_on_hand),
    pac_contributions: pacs,
    pac_total: pacTotal,
    pac_count: pacs.length,
    pac_dependency_percentage: percent(pacTotal, receipts),
  };
}

function buildInsights({ candidates, pacs, summary }) {
  const topCandidate = candidates[0];
  const topPac = pacs[0];

  const insights = [];

  if (topCandidate) {
    insights.push({
      type: "Finance Leader",
      tone: "active",
      title: `${topCandidate.name} leads the finance board`,
      description: `${topCandidate.name} reports ${money(topCandidate.receipts)} in total receipts and ${money(topCandidate.cash_on_hand)} cash on hand.`,
    });
  }

  if (topPac) {
    insights.push({
      type: "PAC Influence",
      tone: "accent",
      title: `${topPac.committee_name} is the top named PAC / committee`,
      description: `${topPac.committee_name} accounts for ${money(topPac.total_amount)} across ${topPac.candidate_count} candidate relationships.`,
    });
  }

  insights.push({
    type: "Finance Concentration",
    tone: summary.concentration_score >= 65 ? "warning" : "info",
    title: `${summary.concentration_score}% concentration score`,
    description:
      "This measures how much of the visible finance universe is concentrated among the top ten candidates.",
  });

  insights.push({
    type: "PAC Dependency",
    tone: summary.pac_dependency_percentage >= 40 ? "warning" : "info",
    title: `${summary.pac_dependency_percentage}% named PAC dependency`,
    description:
      "This estimates the share of visible receipts tied to named PAC and committee contribution records.",
  });

  return insights;
}

export async function getCampaignFinanceIntelligence(input = {}) {
  const payload = await getFundraisingLeaderboard({
    ...input,
    limit: input.limit || 1000,
  });

  const candidates = (payload.leaderboard || []).map(normalizeCandidate);
  const pacs = flattenPacs(candidates);

  const totalReceipts = candidates.reduce((sum, row) => sum + n(row.receipts), 0);
  const totalCash = candidates.reduce((sum, row) => sum + n(row.cash_on_hand), 0);
  const pacTotal = candidates.reduce((sum, row) => sum + n(row.pac_total), 0);
  const topTenReceipts = candidates
    .slice(0, 10)
    .reduce((sum, row) => sum + n(row.receipts), 0);

  const states = groupBy(candidates, "state");
  const parties = groupBy(candidates, "party");
  const offices = groupBy(candidates, "office");

  const summary = {
    tracked_candidates: candidates.length,
    total_receipts: totalReceipts,
    total_cash_on_hand: totalCash,
    average_receipts: candidates.length ? Math.round(totalReceipts / candidates.length) : 0,
    pac_committees: pacs.length,
    pac_total: pacTotal,
    states: states.length,
    parties: parties.length,
    offices: offices.length,
    concentration_score: percent(topTenReceipts, totalReceipts),
    pac_dependency_percentage: percent(pacTotal, totalReceipts),
  };

  return {
    ok: true,
    source: "campaign-finance-intelligence",
    cycle: payload.cycle,
    summary,
    leaderboards: {
      candidates,
      pacs,
      states,
      parties,
      offices,
    },
    insights: buildInsights({ candidates, pacs, summary }),
    selected_candidate: candidates[0] || null,
    updated_at: new Date().toISOString(),
  };
}

export async function syncCampaignFinanceIntelligence(input = {}) {
  const cycle = Number(input.cycle || process.env.FEC_DEFAULT_CYCLE || process.env.FEC_CYCLE || 2026);

  return syncFundraisingFromFec({
    cycle,
    syncContacts: false,
    pacSyncLimit: Number(input.pacSyncLimit || process.env.FEC_PAC_SYNC_LIMIT || 500),
  });
}
