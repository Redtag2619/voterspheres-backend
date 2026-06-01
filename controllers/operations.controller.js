import { pool } from "../db/pool.js";
import { loadOperationsLiveSignals } from "../services/operationsLiveSignals.service.js";
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
      SELECT id, name, locality_type, state_code, state_name, county_fips, full_fips
      FROM state_localities
      WHERE state_code = $1
      ORDER BY name ASC
      LIMIT 500
    `,
    [stateCode]
  );

  if (stateCode === "DC" && rows.length === 0) {
    return [{
      id: "dc-001",
      name: "District of Columbia",
      locality_type: "District",
      state_code: "DC",
      state_name: "District of Columbia",
      county_fips: "001",
      full_fips: "11001",
    }];
  }

  return rows;
}

async function getStateRows() {
  const { rows } = await pool.query(`
    SELECT state_code, MAX(state_name) AS state_name, COUNT(*)::int AS locality_count
    FROM state_localities
    GROUP BY state_code
    ORDER BY state_code ASC
  `);

  return rows;
}

async function buildScoredState(stateRow, liveSignals) {
  const localities = await getLocalitiesByState(stateRow.state_code);

  const counties = localities.map((locality, index) => ({
    ...locality,
    dma: dmaName(locality.state_code, index),
    ...scoreCountyHeat(locality, index, liveSignals),
  }));

  const heatSummary = summarizeHeat(counties);

  return {
    state: stateRow.state_code,
    state_code: stateRow.state_code,
    state_name: stateRow.state_name,
    locality_count: Number(stateRow.locality_count || 0),
    counties_tracked: Number(stateRow.locality_count || 0),
    pressure: heatSummary.heat_score,
    heat_score: heatSummary.heat_score,
    risk: heatSummary.risk,
    critical_counties: heatSummary.critical_counties,
    high_counties: heatSummary.high_counties,
    elevated_counties: heatSummary.elevated_counties,
    stable_counties: heatSummary.stable_counties,
    active_task_count: heatSummary.active_task_count || 0,
    resolved_task_count: heatSummary.resolved_task_count || 0,
    vendor_gap_count: heatSummary.vendor_gap_count,
    total_mail_jobs: heatSummary.total_mail_jobs,
    total_alerts: heatSummary.total_alerts,
    counties,
  };
}

export async function getStateOperationsIndex(req, res) {
  try {
    const liveSignals = await loadOperationsLiveSignals();
    const rows = await getStateRows();

    const states = [];

    for (const row of rows) {
      const scored = await buildScoredState(row, liveSignals);
      const { counties, ...stateSummary } = scored;
      states.push(stateSummary);
    }

    const tacticalFeed = states
      .filter((state) => state.risk === "Critical" || state.risk === "High" || state.active_task_count > 0)
      .sort((a, b) => Number(b.heat_score || 0) - Number(a.heat_score || 0))
      .slice(0, 15)
      .map((state, index) => ({
        id: `${state.state_code}-state-feed-${index}`,
        title: state.active_task_count
          ? `${state.state_name} has active county escalations`
          : `${state.state_name} tactical pressure ${String(state.risk || "signal").toLowerCase()}`,
        state: state.state_code,
        severity: state.active_task_count ? "High" : state.risk,
        source: "National Tactical Feed",
        layer: "State Heat",
        heat_score: state.heat_score,
        command_status: state.active_task_count ? "Task Active" : state.resolved_task_count ? "Resolved" : "No Task",
        recommendation:
          state.active_task_count > 0
            ? "Open State Operations and inspect active county escalations."
            : "Monitor statewide pressure and inspect county-level readiness.",
        created_at: new Date().toISOString(),
      }));

    const summary = {
      states_tracked: states.length,
      localities_tracked: states.reduce((sum, item) => sum + Number(item.locality_count || 0), 0),
      national_heat_score: states.length
        ? Number((states.reduce((sum, item) => sum + Number(item.heat_score || 0), 0) / states.length).toFixed(2))
        : 0,
      critical_states: states.filter((item) => item.risk === "Critical").length,
      urgent_states: states.filter((item) => ["Critical", "High"].includes(item.risk)).length,
      active_task_count: states.reduce((sum, item) => sum + Number(item.active_task_count || 0), 0),
      resolved_task_count: states.reduce((sum, item) => sum + Number(item.resolved_task_count || 0), 0),
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
    const liveSignals = await loadOperationsLiveSignals();
    const rows = await getLocalitiesByState(stateCode);

    const counties = rows.map((row, index) => ({
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
      ...scoreCountyHeat(row, index, liveSignals),
    }));

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
      const heat = Number((item.heat_total / Math.max(1, item.counties)).toFixed(2));
      const vendorScore = Number((item.vendor_total / Math.max(1, item.counties)).toFixed(2));

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

    const tacticalFeed = buildTacticalFeed({ stateCode, counties, limit: 20 });
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
      active_task_count: summaryHeat.active_task_count || 0,
      resolved_task_count: summaryHeat.resolved_task_count || 0,
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

export async function getOperationsMap(req, res) {
  try {
    const liveSignals = await loadOperationsLiveSignals();
    const rows = await getStateRows();

    const states = [];
    const allCounties = [];

    for (const row of rows) {
      const scored = await buildScoredState(row, liveSignals);
      const { counties, ...stateSummary } = scored;

      states.push(stateSummary);

      for (const county of counties) {
        allCounties.push({
          id: county.id,
          name: county.name,
          type: county.locality_type || county.type || "County",
          state: county.state_code,
          state_code: county.state_code,
          state_name: county.state_name,
          county_fips: county.county_fips,
          full_fips: county.full_fips,
          dma: county.dma,
          heat_score: county.heat_score,
          pressure: county.pressure,
          risk: county.risk,
          command_status: county.command_status,
          task_active: county.task_active,
          task_resolved: county.task_resolved,
          active_task_count: county.active_task_count,
          resolved_task_count: county.resolved_task_count,
          vendor_gap_score: county.vendor_gap_score,
          mailops_score: county.mailops_score,
          turnout_pressure: county.turnout_pressure,
          top_drivers: county.top_drivers || [],
        });
      }
    }

    const topHeatCounties = allCounties
      .sort((a, b) => Number(b.heat_score || 0) - Number(a.heat_score || 0))
      .slice(0, 25);

    const activeEscalations = allCounties
      .filter((county) => county.task_active)
      .sort((a, b) => Number(b.heat_score || 0) - Number(a.heat_score || 0))
      .slice(0, 30);

    const resolvedEscalations = allCounties
      .filter((county) => county.task_resolved)
      .sort((a, b) => Number(b.heat_score || 0) - Number(a.heat_score || 0))
      .slice(0, 30);

    const tacticalFeed = [
      ...activeEscalations.map((county, index) => ({
        id: `${county.full_fips || county.id}-active-${index}`,
        title: `${county.name}, ${county.state_code} has active command escalation`,
        state: county.state_code,
        county: county.name,
        severity: "High",
        layer: "County Escalation",
        source: "Operations Map",
        heat_score: county.heat_score,
        command_status: "Task Active",
      })),
      ...topHeatCounties.slice(0, 15).map((county, index) => ({
        id: `${county.full_fips || county.id}-heat-${index}`,
        title: `${county.name}, ${county.state_code} heat score ${county.heat_score}`,
        state: county.state_code,
        county: county.name,
        severity: county.risk,
        layer: "County Heat",
        source: "Operations Map",
        heat_score: county.heat_score,
        command_status: county.command_status,
      })),
    ].slice(0, 30);

    const summary = {
      states_tracked: states.length,
      counties_tracked: allCounties.length,
      national_heat_score: states.length
        ? Number((states.reduce((sum, item) => sum + Number(item.heat_score || 0), 0) / states.length).toFixed(2))
        : 0,
      active_escalations: activeEscalations.length,
      resolved_escalations: resolvedEscalations.length,
      critical_counties: allCounties.filter((county) => county.risk === "Critical").length,
      high_counties: allCounties.filter((county) => county.risk === "High").length,
    };

    return res.json({
      ok: true,
      summary,
      states,
      counties: allCounties,
      activeEscalations,
      resolvedEscalations,
      topHeatCounties,
      tacticalFeed,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[operations] map fatal error", error);

    return res.status(500).json({
      error: "Failed to load operations map",
      detail: error.message,
    });
  }
}
