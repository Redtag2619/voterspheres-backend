function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function groupCount(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row?.[key] || "Unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function normalizeFundraisingRows(fundraisingRows = []) {
  return fundraisingRows.map((row) => ({
    candidate_id: row.candidate_id,
    name: row.name,
    state: row.state || "Unknown",
    office: row.office || "Unknown",
    party: row.party || "Unknown",
    receipts: safeNumber(row?.totals?.receipts),
    disbursements: safeNumber(row?.totals?.disbursements),
    cash_on_hand: safeNumber(row?.totals?.cash_on_hand_end_period),
    debt: safeNumber(row?.totals?.debts_owed_by_committee)
  }));
}

function buildRaceKey(row) {
  return `${row.state || "Unknown"}::${row.office || "Unknown"}`;
}

function overlayTierFromScore(score) {
  if (score >= 80) return "critical";
  if (score >= 65) return "high";
  if (score >= 45) return "elevated";
  return "watch";
}

function fillFromTier(tier) {
  if (tier === "critical") return "#ef4444";
  if (tier === "high") return "#f59e0b";
  if (tier === "elevated") return "#0ea5e9";
  return "#334155";
}

function strokeFromTier(tier) {
  if (tier === "critical") return "#fecaca";
  if (tier === "high") return "#fde68a";
  if (tier === "elevated") return "#bae6fd";
  return "#94a3b8";
}

function urgencyFromScore(score) {
  if (score >= 80) return "Immediate";
  if (score >= 65) return "High";
  if (score >= 45) return "Elevated";
  return "Monitor";
}

function buildRaceForecasts({ candidateRows = [], fundraisingRows = [] }) {
  const fundraising = normalizeFundraisingRows(fundraisingRows);
  const candidatesByState = groupCount(candidateRows, "state_name");
  const races = {};

  for (const row of fundraising) {
    const raceKey = buildRaceKey(row);

    if (!races[raceKey]) {
      races[raceKey] = {
        raceKey,
        state: row.state,
        office: row.office,
        candidates: [],
        totalReceipts: 0,
        totalCash: 0
      };
    }

    races[raceKey].candidates.push(row);
    races[raceKey].totalReceipts += row.receipts;
    races[raceKey].totalCash += row.cash_on_hand;
  }

  return Object.values(races)
    .map((race) => {
      const sorted = [...race.candidates].sort(
        (a, b) => b.receipts - a.receipts
      );

      const leader = sorted[0] || null;
      const runnerUp = sorted[1] || null;

      const receiptsGap =
        leader && runnerUp ? leader.receipts - runnerUp.receipts : 0;
      const cashGap =
        leader && runnerUp ? leader.cash_on_hand - runnerUp.cash_on_hand : 0;
      const stateIntensity = safeNumber(candidatesByState[race.state], 0);

      const fundraisingScore = clamp(
        50 + receiptsGap / 50000 + cashGap / 75000 + stateIntensity * 1.5,
        5,
        95
      );

      const winProbability = clamp(Math.round(fundraisingScore), 5, 95);

      let rating = "Toss-up";
      if (winProbability >= 70) rating = "Likely";
      else if (winProbability >= 60) rating = "Lean";
      else if (winProbability <= 40) rating = "Tilt";

      const volatility =
        leader && runnerUp
          ? clamp(
              100 - Math.abs(leader.receipts - runnerUp.receipts) / 10000,
              10,
              95
            )
          : 70;

      const competitionWeight = clamp(
        Math.round(100 - Math.abs(winProbability - 50) * 2),
        5,
        100
      );

      const financeWeight = clamp(
        Math.round(
          race.totalReceipts / 100000 +
            race.totalCash / 150000 +
            stateIntensity * 4
        ),
        5,
        100
      );

      const overlayScore = clamp(
        Math.round(competitionWeight * 0.55 + financeWeight * 0.45),
        5,
        100
      );

      const overlayTier = overlayTierFromScore(overlayScore);

      return {
        raceKey: race.raceKey,
        state: race.state,
        office: race.office,
        candidateCount: race.candidates.length,
        leader: leader
          ? {
              candidate_id: leader.candidate_id,
              name: leader.name,
              party: leader.party,
              receipts: leader.receipts,
              cash_on_hand: leader.cash_on_hand
            }
          : null,
        runnerUp: runnerUp
          ? {
              candidate_id: runnerUp.candidate_id,
              name: runnerUp.name,
              party: runnerUp.party,
              receipts: runnerUp.receipts,
              cash_on_hand: runnerUp.cash_on_hand
            }
          : null,
        totalReceipts: race.totalReceipts,
        totalCash: race.totalCash,
        receiptsGap,
        cashGap,
        winProbability,
        confidence: clamp(
          Math.round((100 - volatility + stateIntensity) / 1.3),
          20,
          95
        ),
        rating,
        volatility: Math.round(volatility),
        competitionWeight,
        financeWeight,
        overlayScore,
        overlayTier,
        fill: fillFromTier(overlayTier),
        stroke: strokeFromTier(overlayTier),
        urgency: urgencyFromScore(overlayScore)
      };
    })
    .sort((a, b) => b.overlayScore - a.overlayScore);
}

export function buildForecastPackage({
  candidateRows = [],
  fundraisingRows = []
}) {
  const races = buildRaceForecasts({ candidateRows, fundraisingRows });

  const summary = {
    trackedRaces: races.length,
    highConfidenceRaces: races.filter((r) => r.confidence >= 70).length,
    tossups: races.filter((r) => r.rating === "Toss-up").length,
    totalModeledReceipts: races.reduce((sum, race) => sum + race.totalReceipts, 0),
    criticalOverlays: races.filter((r) => r.overlayTier === "critical").length
  };

  const leaderboard = races.slice(0, 12).map((race, index) => ({
    rank: index + 1,
    raceKey: race.raceKey,
    state: race.state,
    office: race.office,
    leader: race.leader?.name || "Unknown",
    winProbability: race.winProbability,
    confidence: race.confidence,
    rating: race.rating,
    totalReceipts: race.totalReceipts,
    overlayScore: race.overlayScore,
    overlayTier: race.overlayTier
  }));

  const overlays = races.map((race) => ({
    raceKey: race.raceKey,
    state: race.state,
    office: race.office,
    overlayScore: race.overlayScore,
    overlayTier: race.overlayTier,
    fill: race.fill,
    stroke: race.stroke,
    urgency: race.urgency,
    financeWeight: race.financeWeight,
    competitionWeight: race.competitionWeight,
    winProbability: race.winProbability,
    confidence: race.confidence,
    totalReceipts: race.totalReceipts
  }));

  return {
    summary,
    races,
    leaderboard,
    overlays
  };
}
