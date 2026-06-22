const FEC_API_BASE_URL =
  process.env.FEC_API_BASE_URL || "https://api.open.fec.gov/v1";

const FEC_API_KEY =
  process.env.FEC_API_KEY ||
  process.env.OPENFEC_API_KEY ||
  "";

const DEFAULT_CYCLE =
  Number(process.env.FEC_DEFAULT_CYCLE || 2026);

function clean(value = "") {
  return String(value || "").trim();
}

function amount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function relationshipStrength(total) {
  if (total >= 100000) return "High";
  if (total >= 25000) return "Medium";
  if (total >= 5000) return "Growing";
  return "New";
}

async function fetchFec(params = {}) {
  if (!FEC_API_KEY) {
    throw new Error(
      "FEC_API_KEY missing. Add it to Render environment variables."
    );
  }

  const cycle = Number(params.cycle || DEFAULT_CYCLE);

  const url = new URL(
    `${FEC_API_BASE_URL}/schedules/schedule_a/`
  );

  url.searchParams.set("api_key", FEC_API_KEY);
  url.searchParams.set(
    "two_year_transaction_period",
    cycle
  );
  url.searchParams.set("per_page", "100");
  url.searchParams.set(
    "sort",
    "-contribution_receipt_amount"
  );

  if (params.state) {
    url.searchParams.set(
      "contributor_state",
      String(params.state).toUpperCase()
    );
  }

  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `FEC request failed (${response.status}): ${text}`
    );
  }

  return response.json();
}

function normalizeContributions(rows = []) {
  const grouped = {};

  rows.forEach((row) => {
    const donorName =
      clean(row.contributor_name) || "Unknown Donor";

    const state =
      clean(row.contributor_state) || "Unknown";

    const committeeName =
      clean(
        row.committee?.name ||
          row.committee_name
      ) || "Unknown Committee";

    const key =
      donorName +
      "|" +
      state +
      "|" +
      committeeName;

    if (!grouped[key]) {
      grouped[key] = {
        donor_name: donorName,
        donor_type:
          row.entity_type_desc ||
          "Individual",
        state,
        committee_name: committeeName,
        amount: 0,
        contribution_count: 0,
        source: "FEC Schedule A",
      };
    }

    grouped[key].amount += amount(
      row.contribution_receipt_amount
    );

    grouped[key].contribution_count += 1;
  });

  return Object.values(grouped)
    .map((item, index) => ({
      id: index + 1,
      ...item,
      relationship_strength:
        relationshipStrength(item.amount),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function buildSummary(rows = []) {
  const totalAmount = rows.reduce(
    (sum, row) => sum + amount(row.amount),
    0
  );

  const states = {};

  rows.forEach((row) => {
    states[row.state] =
      (states[row.state] || 0) +
      amount(row.amount);
  });

  const topState =
    Object.entries(states).sort(
      (a, b) => b[1] - a[1]
    )[0]?.[0] || "N/A";

  return {
    total_donors: rows.length,
    total_amount: totalAmount,
    top_state: topState,
    source: "FEC Schedule A",
  };
}

async function getDonorNetwork(
  params = {}
) {
  const fecData = await fetchFec(params);

  const normalized =
    normalizeContributions(
      fecData.results || []
    );

  return {
    results: normalized,
    summary: buildSummary(normalized),
    _demo: false,
  };
}

module.exports = {
  getDonorNetwork,
};
