import pool from "../db/pool.js";

function riskFromPressure(pressure) {
  if (pressure >= 82) return "Critical";
  if (pressure >= 65) return "High";
  if (pressure >= 42) return "Elevated";
  return "Stable";
}

function pressureForLocality(row, index) {
  const seed =
    Number(row.state_fips || 0) * 7 +
    Number(row.county_fips || 0) * 3 +
    index * 5;

  return Math.max(18, Math.min(96, seed % 100));
}

function fakeDmaName(stateCode, index) {
  const buckets = ["Metro", "Capital", "North", "South", "Coastal", "Central", "Western", "Eastern"];
  return `${stateCode} ${buckets[index % buckets.length]} DMA`;
}

export async function getStateOperationsDrilldown(req, res) {
  try {
    const stateCode = String(req.params.state || "").toUpperCase();

    if (!stateCode || stateCode.length !== 2) {
      return res.status(400).json({ error: "Valid state code is required." });
    }

    const { rows } = await pool.query(
      `
        SELECT
          id,
          state_code,
          state_name,
          state_fips,
          county_fips,
          full_fips,
          name,
          locality_type
        FROM state_localities
        WHERE state_code = $1
        ORDER BY name ASC
      `,
      [stateCode]
    );

    const counties = rows.map((row, index) => {
      const pressure = pressureForLocality(row, index);
      const vendorScore = Math.max(28, Math.min(96, 100 - Math.round(pressure * 0.62)));
      const mailJobs = Math.max(0, Math.round(pressure / 10));
      const alerts = pressure >= 82 ? 4 : pressure >= 65 ? 2 : pressure >= 42 ? 1 : 0;

      return {
        id: row.id,
        name: row.name,
        state: row.state_code,
        state_name: row.state_name,
        state_fips: row.state_fips,
        county_fips: row.county_fips,
        full_fips: row.full_fips,
        type: row.locality_type,
        locality_type: row.locality_type,
        dma: fakeDmaName(row.state_code, index),
        pressure,
        risk: riskFromPressure(pressure),
        mail_jobs: mailJobs,
        vendor_score: vendorScore,
        alerts,
      };
    });

    const dmaMap = new Map();

    for (const county of counties) {
      const existing = dmaMap.get(county.dma) || {
        name: county.dma,
        counties: 0,
        pressure_total: 0,
        mail_jobs: 0,
        vendor_score_total: 0,
        risk: "Stable",
        market_type: "Media market",
      };

      existing.counties += 1;
      existing.pressure_total += Number(county.pressure || 0);
      existing.mail_jobs += Number(county.mail_jobs || 0);
      existing.vendor_score_total += Number(county.vendor_score || 0);

      dmaMap.set(county.dma, existing);
    }

    const dmas = Array.from(dmaMap.values()).map((item) => {
      const pressure = Math.round(item.pressure_total / Math.max(1, item.counties));
      const vendorScore = Math.round(item.vendor_score_total / Math.max(1, item.counties));

      return {
        name: item.name,
        counties: item.counties,
        pressure,
        mail_jobs: item.mail_jobs,
        vendor_score: vendorScore,
        risk: riskFromPressure(pressure),
        market_type: item.market_type,
      };
    });

    const alerts = counties
      .filter((county) => county.alerts > 0)
      .slice(0, 20)
      .map((county) => ({
        id: `${county.full_fips}-alert`,
        title:
          county.risk === "Critical"
            ? "Critical county execution pressure"
            : "County pressure movement detected",
        state: stateCode,
        county: county.name,
        severity: county.risk,
        source: "Operations Engine",
        layer: "County",
      }));

    const summary = {
      state: stateCode,
      state_name: rows[0]?.state_name || stateCode,
      counties_tracked: counties.length,
      critical_counties: counties.filter((county) => county.risk === "Critical").length,
      total_mail_jobs: counties.reduce((sum, county) => sum + Number(county.mail_jobs || 0), 0),
      total_alerts: alerts.length,
      vendor_gap_count: counties.filter((county) => Number(county.vendor_score || 0) < 60).length,
    };

    return res.json({
      summary,
      counties,
      dmas,
      alerts,
    });
  } catch (error) {
    console.error("getStateOperationsDrilldown error", error);
    return res.status(500).json({
      error: "Failed to load state operations drilldown.",
    });
  }
}
