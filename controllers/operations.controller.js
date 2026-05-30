import { pool } from "../db/pool.js";

export async function getStateOperationsDrilldown(req, res) {
  try {
    const stateCode = String(req.params.state || "GA").toUpperCase();
    const workspaceId = req.query.workspace_id || null;

    console.log(
      `[operations] loading state=${stateCode} workspace=${workspaceId}`
    );

    // ---------------------------------------------------
    // SAFE COUNTY / PARISH QUERY
    // ---------------------------------------------------

    let counties = [];

    try {
      const countyQuery = await pool.query(
        `
        SELECT
          id,
          name,
          locality_type,
          state_code,
          county_fips,
          full_fips
        FROM state_localities
        WHERE state_code = $1
        ORDER BY name ASC
        LIMIT 250
        `,
        [stateCode]
      );

      counties = countyQuery.rows.map((row, index) => {
        const pressure = Math.floor(Math.random() * 100);

        let risk = "Stable";

        if (pressure >= 80) risk = "Critical";
        else if (pressure >= 65) risk = "High";
        else if (pressure >= 45) risk = "Elevated";

        return {
          id: row.id,
          name: row.name,
          type: row.locality_type || "County",
          locality_type: row.locality_type || "County",
          state_code: row.state_code,
          county_fips: row.county_fips,
          full_fips: row.full_fips,

          dma: [
            "Atlanta DMA",
            "Savannah DMA",
            "Macon DMA",
            "Baton Rouge DMA",
            "New Orleans DMA",
            "Philadelphia DMA",
            "Phoenix DMA",
          ][index % 7],

          pressure,
          risk,

          mail_jobs: Math.floor(Math.random() * 40),
          vendor_score: Math.floor(Math.random() * 100),
          alerts: Math.floor(Math.random() * 8),
        };
      });
    } catch (dbError) {
      console.error("[operations] county query failed", dbError);

      counties = [];
    }

    // ---------------------------------------------------
    // DMA VIEW
    // ---------------------------------------------------

    const dmas = [
      {
        name: "Atlanta DMA",
        counties: 24,
        market_type: "Broadcast",
        pressure: 82,
        risk: "Critical",
        mail_jobs: 18,
        vendor_score: 71,
      },
      {
        name: "Savannah DMA",
        counties: 12,
        market_type: "Broadcast",
        pressure: 58,
        risk: "Elevated",
        mail_jobs: 7,
        vendor_score: 62,
      },
      {
        name: "Macon DMA",
        counties: 15,
        market_type: "Broadcast",
        pressure: 44,
        risk: "Stable",
        mail_jobs: 4,
        vendor_score: 55,
      },
    ];

    // ---------------------------------------------------
    // EXECUTIVE ALERTS
    // ---------------------------------------------------

    const alerts = counties
      .filter((c) => c.risk === "Critical" || c.risk === "High")
      .slice(0, 10)
      .map((county, index) => ({
        id: index + 1,
        title: `${county.name} operational pressure rising`,
        county: county.name,
        severity: county.risk,
        source: "Operational Pulse",
        layer: "County Readiness",
      }));

    // ---------------------------------------------------
    // SUMMARY
    // ---------------------------------------------------

    const summary = {
      counties_tracked: counties.length,

      critical_counties: counties.filter(
        (c) => c.risk === "Critical"
      ).length,

      total_mail_jobs: counties.reduce(
        (sum, c) => sum + Number(c.mail_jobs || 0),
        0
      ),

      total_alerts: alerts.length,

      vendor_gap_count: counties.filter(
        (c) => Number(c.vendor_score || 0) < 45
      ).length,
    };

    // ---------------------------------------------------
    // RESPONSE
    // ---------------------------------------------------

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
    console.error("[operations] fatal error", error);

    return res.status(500).json({
      error: "Failed to load state operations drilldown",
      detail: error.message,
    });
  }
}
