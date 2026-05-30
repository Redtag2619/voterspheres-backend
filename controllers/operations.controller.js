import { pool } from "../db/pool.js";

function riskFromPressure(pressure) {
  if (pressure >= 82) return "Critical";
  if (pressure >= 65) return "High";
  if (pressure >= 42) return "Elevated";
  return "Stable";
}

function pressureForRow(row, index) {
  return Math.max(
    18,
    Math.min(
      96,
      (Number(row.county_fips || 0) * 7 +
        index * 13 +
        String(row.state_code || "").charCodeAt(0)) %
        100
    )
  );
}

function dmaName(stateCode, index) {
  const buckets = ["Metro", "Capital", "North", "South", "Central", "Western", "Eastern", "Coastal"];
  return `${stateCode} ${buckets[index % buckets.length]} DMA`;
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
      const pressure = Math.max(
        18,
        Math.min(96, (index * 11 + Number(row.locality_count || 0) * 3) % 100)
      );

      const risk = riskFromPressure(pressure);

      return {
        state: row.state_code,
        state_code: row.state_code,
        state_name: row.state_name,
        locality_count: Number(row.locality_count || 0),
        counties_tracked: Number(row.locality_count || 0),
        pressure,
        risk,
        critical_counties:
          risk === "Critical"
            ? Math.max(1, Math.round(Number(row.locality_count || 0) * 0.08))
            : 0,
        vendor_gap_count:
          pressure >= 55
            ? Math.max(1, Math.round(Number(row.locality_count || 0) * 0.1))
            : 0,
        total_mail_jobs: Math.round(pressure / 3),
        total_alerts:
          risk === "Critical" ? 5 : risk === "High" ? 3 : risk === "Elevated" ? 1 : 0,
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

    let { rows } = await pool.query(
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
      rows = [
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

    const counties = rows.map((row, index) => {
      const pressure = pressureForRow(row, index);
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
        vendor_gap_score: pressure,
        alerts: risk === "Critical" ? 4 : risk === "High" ? 2 : risk === "Elevated" ? 1 : 0,
      };
    });

    const dmas = [];

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
      vendor_gap_count: counties.filter((county) => Number(county.vendor_gap_score || 0) >= 55).length,
    };

    return res.json({
      ok: true,
      state: stateCode,
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
