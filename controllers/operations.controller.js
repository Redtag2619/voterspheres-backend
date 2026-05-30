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
        MAX(state_name) AS state_name,
        COUNT(*)::int AS locality_count
      FROM state_localities
      GROUP BY state_code
      ORDER BY state_code ASC
    `);

    const states = rows.map((row, index) => {
      const pressure = Math.max(18, Math.min(96, (index * 11 + Number(row.locality_count || 0) * 3) % 100));

      const risk =
        pressure >= 82 ? "Critical" :
        pressure >= 65 ? "High" :
        pressure >= 42 ? "Elevated" :
        "Stable";

      return {
        state: row.state_code,
        state_code: row.state_code,
        state_name: row.state_name,
        locality_count: Number(row.locality_count || 0),
        counties_tracked: Number(row.locality_count || 0),
        pressure,
        risk,
        critical_counties: risk === "Critical" ? Math.max(1, Math.round(Number(row.locality_count || 0) * 0.08)) : 0,
        vendor_gap_count: pressure >= 55 ? Math.max(1, Math.round(Number(row.locality_count || 0) * 0.1)) : 0,
        total_mail_jobs: Math.round(pressure / 3),
        total_alerts: risk === "Critical" ? 5 : risk === "High" ? 3 : risk === "Elevated" ? 1 : 0,
      };
    });

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
