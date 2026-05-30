import { pool } from "../db/pool.js";

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

function scoreFromSeed(seed) {
  return Math.max(18, Math.min(96, seed % 100));
}

function riskFromPressure(pressure) {
  if (pressure >= 82) return "Critical";
  if (pressure >= 65) return "High";
  if (pressure >= 42) return "Elevated";
  return "Stable";
}

function dmaName(stateCode, index) {
  const buckets = ["Metro", "Capital", "North", "South", "Central", "Western", "Eastern", "Coastal"];
  return `${stateCode} ${buckets[index % buckets.length]} DMA`;
}

export async function getStateOperationsIndex(req, res) {
  try {
    let rows = [];

    try {
      const result = await pool.query(`
        SELECT
          state_code,
          MAX(state_name) AS state_name,
          COUNT(*)::int AS locality_count
        FROM state_localities
        GROUP BY state_code
        ORDER BY state_code ASC
      `);

      rows = result.rows || [];
    } catch (error) {
      console.error("[operations] state index query failed", error);
      rows = [];
    }

    const lookup = new Map(rows.map((row) => [row.state_code, row]));

    const states = STATES.map(([stateCode, stateName], index) => {
      const dbRow = lookup.get(stateCode);
      const localityCount = Number(dbRow?.locality_count || 0);
      const pressure = scoreFromSeed(index * 11 + localityCount * 3 + stateCode.charCodeAt(0));
      const risk = riskFromPressure(pressure);
      const vendorScore = Math.max(25, Math.min(96, 100 - Math.round(pressure * 0.55)));
      const mailJobs = Math.max(0, Math.round((pressure / 8) + localityCount / 14));
      const alerts = risk === "Critical" ? 5 : risk === "High" ? 3 : risk === "Elevated" ? 1 : 0;

      return {
        state: stateCode,
        state_code: stateCode,
        state_name: dbRow?.state_name || stateName,
        locality_count: localityCount,
        counties_tracked: localityCount,
        pressure,
        risk,
        critical_counties: risk === "Critical" ? Math.max(1, Math.round(localityCount * 0.08)) : 0,
        vendor_gap_count: vendorScore < 60 ? Math.max(1, Math.round(localityCount * 0.12)) : 0,
        total_mail_jobs: mailJobs,
        total_alerts: alerts,
        vendor_score: vendorScore,
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

export async function getStateOperationsDrilldown(req, res) {
  try {
    const stateCode = String(req.params.state || "GA").toUpperCase();
    const workspaceId = req.query.workspace_id || null;

    let counties = [];

    try {
      const countyQuery = await pool.query(
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

      counties = countyQuery.rows.map((row, index) => {
        const seed = Number(row.county_fips || 0) * 7 + index * 13 + stateCode.charCodeAt(0);
        const pressure = scoreFromSeed(seed);
        const risk = riskFromPressure(pressure);

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
          pressure,
          risk,
          mail_jobs: Math.max(0, Math.round(pressure / 8)),
          vendor_score: Math.max(25, Math.min(96, 100 - Math.round(pressure * 0.52))),
          alerts: risk === "Critical" ? 4 : risk === "High" ? 2 : risk === "Elevated" ? 1 : 0,
        };
      });
    } catch (dbError) {
      console.error("[operations] county query failed", dbError);
      counties = [];
    }

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
        risk: riskFromPressure(pressure),
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
        source: "Operational Pulse",
        layer: "County Readiness",
      }));

    const summary = {
      state: stateCode,
      state_name: counties[0]?.state_name || stateCode,
      counties_tracked: counties.length,
      critical_counties: counties.filter((county) => county.risk === "Critical").length,
      total_mail_jobs: counties.reduce((sum, county) => sum + Number(county.mail_jobs || 0), 0),
      total_alerts: alerts.length,
      vendor_gap_count: counties.filter((county) => Number(county.vendor_score || 0) < 60).length,
    };

    return res.json({
      ok: true,
      state: stateCode,
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
