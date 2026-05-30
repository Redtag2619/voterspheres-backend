import { pool } from "../db/pool.js";
import {
  buildTacticalFeed,
  riskFromHeat,
  scoreCountyHeat,
  summarizeHeat,
} from "../services/tacticalIntelligence.service.js";

function dmaName(stateCode, index) {
  const buckets = ["Metro", "Capital", "North", "South", "Central", "Western", "Eastern", "Coastal"];
  return `${stateCode} ${buckets[index % buckets.length]} DMA`;
}

async function getLocalitiesByState(stateCode) {
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

  if (stateCode === "DC" && rows.length === 0) {
    return [
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

  return rows;
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

    const states = [];

    for (const row of rows) {
      const localities = await getLocalitiesByState(row.state_code);

      const scored = localities.map((locality, index) => ({
        ...locality,
        ...scoreCountyHeat(locality, index),
      }));

      const heatSummary = summarizeHeat(scored);

      states.push({
        state: row.state_code,
        state_code: row.state_code,
        state_name: row.state_name,
        locality_count: Number(row.locality_count || 0),
        counties_tracked: Number(row.locality_count || 0),

        pressure: heatSummary.heat_score,
        heat_score: heatSummary.heat_score,
        risk: heatSummary.risk,

        critical_counties: heatSummary.critical_counties,
        high_counties: heatSummary.high_counties,
        elevated_counties: heatSummary.elevated_counties,
        stable_counties: heatSummary.stable_counties,

        vendor_gap_count: heatSummary.vendor_gap_count,
        total_mail_jobs: heatSummary.total_mail_jobs,
        total_alerts: heatSummary.total_alerts,
      });
    }

    const tacticalFeed = states
      .filter((state) => state.risk === "Critical" || state.risk === "High")
      .sort((a, b) => Number(b.heat_score || 0) - Number(a.heat_score || 0))
      .slice(0, 15)
      .map((state, index) => ({
        id: `${state.state_code}-state-feed-${index}`,
        title: `${state.state_name} tactical pressure ${state.risk.toLowerCase()}`,
        state: state.state_code,
        severity: state.risk,
        source: "National Tactical Feed",
        layer: "State Heat",
        heat_score: state.heat_score,
        recommendation:
          state.risk === "Critical"
            ? "Escalate statewide operational review and inspect county heat concentration."
            : "Monitor statewide pressure and inspect county-level readiness.",
        created_at: new Date().toISOString(),
      }));

    const summary = {
      states_tracked: states.length,
      localities_tracked: states.reduce((sum, item) => sum + Number(item.locality_count || 0), 0),
      national_heat_score: states.length
        ? Math.round(states.reduce((sum, item) => sum + Number(item.heat_score || 0), 0) / states.length)
        : 0,
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
      tacticalFeed,
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
    const rows = await getLocalitiesByState(stateCode);

    const counties = rows.map((row, index) => {
      const scoring = scoreCountyHeat(row, index);

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

        ...scoring,
      };
    });

    const dmaMap = new Map();

    for (const county of counties) {
      const current = dmaMap.get(county.dma) || {
        name: county.dma,
        counties: 0,
        heat_total: 0,
        mail_jobs: 0,
        vendor_total: 0,
        market_type: "Media market",
      };

      current.counties += 1;
      current.heat_total += Number(county.heat_score || 0);
      current.mail_jobs += Number(county.mail_jobs || 0);
      current.vendor_total += Number(county.vendor_score || 0);

      dmaMap.set(county.dma, current);
    }

    const dmas = Array.from(dmaMap.values()).map((item) => {
      const heat = Math.round(item.heat_total / Math.max(1, item.counties));
      const vendorScore = Math.round(item.vendor_total / Math.max(1, item.counties));

      return {
        name: item.name,
        counties: item.counties,
        market_type: item.market_type,
        pressure: heat,
        heat_score: heat,
        risk: riskFromHeat(heat),
        mail_jobs: item.mail_jobs,
        vendor_score: vendorScore,
      };
    });

    const tacticalFeed = buildTacticalFeed({
      stateCode,
      counties,
      limit: 20,
    });

    const summaryHeat = summarizeHeat(counties);

    const summary = {
      state: stateCode,
      state_name: counties[0]?.state_name || stateCode,
      counties_tracked: counties.length,

      heat_score: summaryHeat.heat_score,
      risk: summaryHeat.risk,
      critical_counties: summaryHeat.critical_counties,
      high_counties: summaryHeat.high_counties,
      elevated_counties: summaryHeat.elevated_counties,
      stable_counties: summaryHeat.stable_counties,

      total_mail_jobs: summaryHeat.total_mail_jobs,
      total_alerts: summaryHeat.total_alerts,
      vendor_gap_count: summaryHeat.vendor_gap_count,
    };

    return res.json({
      ok: true,
      state: stateCode,
      summary,
      counties,
      dmas,
      alerts: tacticalFeed,
      tacticalFeed,
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
