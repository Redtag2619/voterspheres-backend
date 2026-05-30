import { pool } from "../db/pool.js";
import {
  loadOperationsSignalMaps,
  scoreLocality,
  summarizeStateFromLocalities,
} from "../services/operationsScoring.service.js";

const STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"],
  ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

function dmaName(stateCode, index) {
  const buckets = ["Metro", "Capital", "North", "South", "Central", "Western", "Eastern", "Coastal"];
  return `${stateCode} ${buckets[index % buckets.length]} DMA`;
}

async function getLocalitiesForState(stateCode) {
  const { rows } = await pool.query(
    `
      SELECT
        id,
        name,
        locality_type,
        state_code,
        state_name,
        county_fips,
        full_fips
      FROM state_localities
      WHERE state_code = $1
      ORDER BY name ASC
      LIMIT 500
    `,
    [stateCode]
  );

  return rows;
}

export async function getStateOperationsIndex(req, res) {
  try {
    const signalMaps = await loadOperationsSignalMaps();

    const { rows } = await pool.query(`
      SELECT
        state_code,
        MAX(state_name) AS state_name,
        COUNT(*)::int AS locality_count
      FROM state_localities
      GROUP BY state_code
      ORDER BY state_code ASC
    `);

    const countLookup = new Map(rows.map((row) => [row.state_code, row]));

    const states = [];

    for (const [stateCode, fallbackName] of STATES) {
      const localities = await getLocalitiesForState(stateCode);

      const scoredLocalities = localities.map((locality, index) => ({
        ...locality,
        ...scoreLocality({ locality, index, signalMaps }),
      }));

      const summary = summarizeStateFromLocalities(stateCode, scoredLocalities);
      const countRow = countLookup.get(stateCode);

      states.push({
        state: stateCode,
        state_code: stateCode,
        state_name: countRow?.state_name || fallbackName,
        locality_count: Number(countRow?.locality_count || scoredLocalities.length || 0),
        counties_tracked: Number(countRow?.locality_count || scoredLocalities.length || 0),
        pressure: summary.pressure,
        risk: summary.risk,
        critical_counties: summary.critical_counties,
        vendor_gap_count: summary.vendor_gap_count,
        total_mail_jobs: summary.total_mail_jobs,
        total_alerts: summary.total_alerts,
      });
    }

    const summary = {
      states_tracked: states.length,
      localities_tracked: states.reduce((sum, item) => sum + Number(item.locality_count || 0), 0),
      critical_states: states.filter((item) => item.risk === "Critical").length,
      urgent_states: states.filter((item) => ["Critical", "High"].includes(item.risk)).length,
      vendor_gap_count: states.reduce((sum, item) => sum + Number(item.vendor_gap_count || 0), 0),
      total_mail_jobs: states.reduce((sum, item) => sum + Number(item.total_mail_jobs || 0), 0),
      total_alerts: states.reduce((sum, item) => sum + Number(item.total_alerts || 0), 0),
    };

    return res.json({
      ok: true,
      summary,
      states,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[operations] state index fatal error", error);

    return res.status(500).json({
      error: "Failed to load state operations index",
      detail: error.message,
    });
  }
}

export async function getStateOperationsIndex(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT
        state_code,
        state_name
      FROM state_localities
      GROUP BY state_code, state_name
      ORDER BY state_code ASC
    `);

    const states = rows.map((row, index) => ({
      state: row.state_code,
      state_code: row.state_code,
      state_name: row.state_name,

      locality_count: 0,
      counties_tracked: 0,

      pressure: (index * 7) % 100,

      risk:
        index % 4 === 0
          ? "Critical"
          : index % 3 === 0
          ? "High"
          : index % 2 === 0
          ? "Elevated"
          : "Stable",

      critical_counties: 0,
      vendor_gap_count: 0,
      total_mail_jobs: 0,
      total_alerts: 0,
    }));

    return res.json({
      ok: true,
      summary: {
        states_tracked: states.length,
      },
      states,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("OPERATIONS INDEX FAILURE:", error);

    return res.status(500).json({
      error: "Operations index failed",
      detail: error.message,
    });
  }
}
