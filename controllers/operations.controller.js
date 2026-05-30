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

export async function getStateOperationsDrilldown(req, res) {
  try {
    const stateCode = String(req.params.state || "GA").toUpperCase();
    const normalizedStateCode = stateCode === "DC" ? "DC" : stateCode;
    const workspaceId = req.query.workspace_id || null;

    const signalMaps = await loadOperationsSignalMaps();
    let localities = await getLocalitiesForState(normalizedStateCode);

if (normalizedStateCode === "DC" && !localities.length) {
  localities = [
    {
      id: "dc-001",
      name: "District of Columbia",
      locality_type: "District",
      state_code: "DC",
      state_name: "District of Columbia",
      county_fips: "001",
      full_fips: "11001",
    },
  ];
}

    const counties = localities.map((row, index) => {
      const scoring = scoreLocality({ locality: row, index, signalMaps });

      return {
        id: row.id,
        name: row.name,
        type: row.locality_type || "County",
        locality_type: row.locality_type || "County",
        state: row.state_code,
        state_code: row.state_code,
        state_name: row.state_name,
        county_fips: row.county_fips,
        full_fips: row.full_fips,
        dma: dmaName(row.state_code, index),

        pressure: scoring.pressure,
        risk: scoring.risk,

        mail_jobs: Math.max(0, Math.round(scoring.mailops_score / 8)),
        vendor_score: scoring.vendor_score,
        vendor_gap_score: scoring.vendor_gap_score,
        alerts: Math.max(0, Math.round(scoring.alert_pressure / 12)),

        mailops_score: scoring.mailops_score,
        task_pressure: scoring.task_pressure,
        alert_pressure: scoring.alert_pressure,
        fundraising_pressure: scoring.fundraising_pressure,
        scoring_breakdown: scoring.scoring_breakdown,
      };
    });

    const dmaMap = new Map();

    for (const county of counties) {
      const current = dmaMap.get(county.dma) || {
        name: county.dma,
        counties: 0,
        pressure_total: 0,
        mail_jobs: 0,
        vendor_total: 0,
        market_type: "Media market",
      };

      current.counties += 1;
      current.pressure_total += Number(county.pressure || 0);
      current.mail_jobs += Number(county.mail_jobs || 0);
      current.vendor_total += Number(county.vendor_score || 0);

      dmaMap.set(county.dma, current);
    }

    const dmas = Array.from(dmaMap.values()).map((item) => {
      const pressure = Math.round(item.pressure_total / Math.max(1, item.counties));
      const vendorScore = Math.round(item.vendor_total / Math.max(1, item.counties));

      return {
        name: item.name,
        counties: item.counties,
        market_type: item.market_type,
        pressure,
        risk: pressure >= 82 ? "Critical" : pressure >= 65 ? "High" : pressure >= 42 ? "Elevated" : "Stable",
        mail_jobs: item.mail_jobs,
        vendor_score: vendorScore,
      };
    });

    const alerts = counties
      .filter((county) => county.risk === "Critical" || county.risk === "High")
      .slice(0, 20)
      .map((county, index) => ({
        id: `${county.full_fips || index}-alert`,
        title: `${county.name} operational pressure rising`,
        county: county.name,
        state: stateCode,
        severity: county.risk,
        source: "Operations Scoring Engine",
        layer: "County Readiness",
      }));

    const summary = {
      state: stateCode,
      state_name: counties[0]?.state_name || stateCode,
      counties_tracked: counties.length,
      critical_counties: counties.filter((county) => county.risk === "Critical").length,
      total_mail_jobs: counties.reduce((sum, county) => sum + Number(county.mail_jobs || 0), 0),
      total_alerts: alerts.length,
      vendor_gap_count: counties.filter((county) => Number(county.vendor_gap_score || 0) >= 55).length,
    };

    return res.json({
      ok: true,
      state: normalizedStateCode,
      workspace_id: workspaceId,
      summary,
      counties,
      dmas,
      alerts,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[operations] drilldown fatal error", error);

    return res.status(500).json({
      error: "Failed to load state operations drilldown",
      detail: error.message,
    });
  }
}
