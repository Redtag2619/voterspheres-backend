import { getIntelligenceInputs } from "../repositories/intelligence.repository.js";

function groupCount(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row?.[key] || "Unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function getStateCoordinates(state) {
  const coords = {
    Alabama: [32.3777, -86.3006],
    Alaska: [58.3019, -134.4197],
    Arizona: [33.4484, -112.074],
    Arkansas: [34.7465, -92.2896],
    California: [38.5767, -121.4944],
    Colorado: [39.7392, -104.9903],
    Connecticut: [41.7658, -72.6734],
    Delaware: [39.1582, -75.5244],
    Florida: [30.4383, -84.2807],
    Georgia: [33.749, -84.388],
    Hawaii: [21.3069, -157.8583],
    Idaho: [43.615, -116.2023],
    Illinois: [39.7983, -89.6544],
    Indiana: [39.7684, -86.1581],
    Iowa: [41.5868, -93.625],
    Kansas: [39.0473, -95.6752],
    Kentucky: [38.2009, -84.8733],
    Louisiana: [30.4515, -91.1871],
    Maine: [44.3106, -69.7795],
    Maryland: [38.9784, -76.4922],
    Massachusetts: [42.3601, -71.0589],
    Michigan: [42.7336, -84.5553],
    Minnesota: [44.9537, -93.09],
    Mississippi: [32.2988, -90.1848],
    Missouri: [38.5767, -92.1735],
    Montana: [46.5891, -112.0391],
    Nebraska: [40.8136, -96.7026],
    Nevada: [39.1638, -119.7674],
    "New Hampshire": [43.2081, -71.5376],
    "New Jersey": [40.2171, -74.7429],
    "New Mexico": [35.687, -105.9378],
    "New York": [42.6526, -73.7562],
    "North Carolina": [35.7796, -78.6382],
    "North Dakota": [46.8083, -100.7837],
    Ohio: [39.9612, -82.9988],
    Oklahoma: [35.4676, -97.5164],
    Oregon: [44.9429, -123.0351],
    Pennsylvania: [40.2732, -76.8867],
    "Rhode Island": [41.824, -71.4128],
    "South Carolina": [34.0007, -81.0348],
    "South Dakota": [44.3683, -100.351],
    Tennessee: [36.1627, -86.7816],
    Texas: [30.2672, -97.7431],
    Utah: [40.7608, -111.891],
    Vermont: [44.2601, -72.5754],
    Virginia: [37.5407, -77.436],
    Washington: [47.0379, -122.9007],
    "West Virginia": [38.3498, -81.6326],
    Wisconsin: [43.0731, -89.4012],
    Wyoming: [41.14, -104.8202]
  };

  return coords[state] || [39.8283, -98.5795];
}

function buildPoliticalIntelligence({
  candidateRows = [],
  consultantRows = [],
  vendorRows = [],
  stateRows = [],
  officeRows = [],
  partyRows = []
}) {
  const candidateCount = candidateRows.length;
  const consultantCount = consultantRows.length;
  const vendorCount = vendorRows.length;
  const stateCount = stateRows.length;
  const officeCount = officeRows.length;
  const partyCount = partyRows.length;

  const candidatesByState = groupCount(candidateRows, "state_name");
  const candidatesByOffice = groupCount(candidateRows, "office_name");

  const topStates = Object.entries(candidatesByState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([state, count], index) => ({
      rank: index + 1,
      state,
      count,
      momentum: `+${Math.max(1, Math.round(count / 2))}.${index}`
    }));

  const forecastRaces = topStates.slice(0, 6).map((item, index) => ({
    race: `${item.state} Control Outlook`,
    winProb: Math.min(69, 50 + item.count + index),
    change: `+${(1.2 + index * 0.4).toFixed(1)}`,
    rating: item.count > 10 ? "Lean" : "Toss-up",
    status: index < 2 ? "Momentum Up" : "Watch"
  }));

  const powerRankings = candidateRows.slice(0, 12).map((candidate, index) => ({
    rank: index + 1,
    name: candidate.full_name || candidate.name || `Candidate ${index + 1}`,
    score: Math.max(72, 96 - index * 2),
    movement: index < 4 ? `+${index + 1}` : `-${Math.max(1, index - 3)}`,
    category: candidate.office_name || candidate.election || "Candidate",
    signal: candidate.state_name || candidate.state || "National"
  }));

  const mapBattlegrounds = topStates.slice(0, 6).map((item, index) => ({
    name: `${item.state} Battleground`,
    state: item.state,
    center: getStateCoordinates(item.state),
    raceRating: index < 2 ? "Lean" : "Toss-up",
    winProb: Math.min(68, 50 + item.count + index),
    momentum: `+${(1.4 + index * 0.5).toFixed(1)}`,
    funds: `$${(item.count * 0.9 + 5).toFixed(1)}M`,
    risk: index < 2 ? "Medium" : "High",
    note: `${item.state} is one of the highest-density political theaters in the platform.`
  }));

  return {
    summary: {
      trackedCandidates: candidateCount,
      consultantsIndexed: consultantCount,
      vendorsIndexed: vendorCount,
      statesTracked: stateCount,
      officesTracked: officeCount,
      partiesTracked: partyCount
    },
    dashboard: {
      metrics: [
        { label: "Tracked Candidates", value: `${candidateCount}`, delta: `Across ${stateCount} states`, tone: "up" },
        { label: "Consultants Indexed", value: `${consultantCount}`, delta: "Marketplace live", tone: "up" },
        { label: "Vendors Indexed", value: `${vendorCount}`, delta: "Operations supply active", tone: "up" },
        { label: "Offices Tracked", value: `${officeCount}`, delta: "Election surface mapped", tone: "neutral" }
      ],
      alerts: [
        {
          title: "Candidate density rising in top state clusters",
          meta: `${topStates[0]?.state || "National"} is leading current platform concentration`,
          severity: "High"
        }
      ],
      raceMoves: topStates.slice(0, 8).map((item) => ({
        race: `${item.state} Cluster`,
        leader: item.state,
        change: item.momentum,
        status: item.count > 8 ? "Momentum Up" : "Watch"
      }))
    },
    forecast: {
      metrics: [
        { label: "National Control Probability", value: `${Math.min(70, 52 + topStates.length)}%`, delta: "+3.1", tone: "up" },
        { label: "Battleground Volatility", value: topStates.length > 5 ? "High" : "Medium", delta: "+7 signals", tone: "down" }
      ],
      races: forecastRaces
    },
    rankings: {
      metrics: [
        { label: "Top Rated Campaign", value: powerRankings[0]?.name || "N/A", delta: powerRankings[0]?.movement || "+0", tone: "up" }
      ],
      campaigns: powerRankings
    },
    map: {
      metrics: [
        { label: "Battleground States", value: `${topStates.length}`, delta: "+2", tone: "up" }
      ],
      battlegrounds: mapBattlegrounds
    },
    counts: {
      candidatesByOffice,
      candidatesByState
    }
  };
}

export async function getIntelligenceSummary(_req, res, next) {
  try {
    const inputs = await getIntelligenceInputs();
    const intelligence = buildPoliticalIntelligence(inputs);
    res.json(intelligence.summary);
  } catch (err) {
    next(err);
  }
}

export async function getIntelligenceDashboard(_req, res, next) {
  try {
    const inputs = await getIntelligenceInputs();
    const intelligence = buildPoliticalIntelligence(inputs);
    res.json(intelligence.dashboard);
  } catch (err) {
    next(err);
  }
}

export async function getIntelligenceForecast(_req, res, next) {
  try {
    const inputs = await getIntelligenceInputs();
    const intelligence = buildPoliticalIntelligence(inputs);
    res.json(intelligence.forecast);
  } catch (err) {
    next(err);
  }
}

export async function getIntelligenceRankings(_req, res, next) {
  try {
    const inputs = await getIntelligenceInputs();
    const intelligence = buildPoliticalIntelligence(inputs);
    res.json(intelligence.rankings);
  } catch (err) {
    next(err);
  }
}

export async function getIntelligenceMap(_req, res, next) {
  try {
    const inputs = await getIntelligenceInputs();
    const intelligence = buildPoliticalIntelligence(inputs);
    res.json(intelligence.map);
  } catch (err) {
    next(err);
  }
}
