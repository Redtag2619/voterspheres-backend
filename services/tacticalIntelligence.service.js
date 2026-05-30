function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

export function riskFromHeat(score) {
  if (score >= 82) return "Critical";
  if (score >= 65) return "High";
  if (score >= 42) return "Elevated";
  return "Stable";
}

function deterministicBase(row, index = 0) {
  const stateSeed =
    String(row.state_code || "")
      .split("")
      .reduce((sum, char) => sum + char.charCodeAt(0), 0) || 10;

  const countySeed = Number(row.county_fips || 0);

  return clamp((stateSeed * 7 + countySeed * 3 + index * 11) % 100, 18, 96);
}

export function scoreCountyHeat(row, index = 0) {
  const baseline = deterministicBase(row, index);

  const battlegroundWeight = ["AZ", "GA", "MI", "NV", "NC", "PA", "WI"].includes(
    String(row.state_code || "").toUpperCase()
  )
    ? 14
    : 4;

  const vendorGap = clamp(100 - ((baseline * 0.73) % 100));
  const mailPressure = clamp((baseline * 0.62 + battlegroundWeight) % 100);
  const turnoutPressure = clamp((baseline * 0.81 + battlegroundWeight) % 100);
  const alertPressure = clamp((baseline * 0.44 + battlegroundWeight) % 100);
  const fundraisingPressure = clamp((baseline * 0.52 + battlegroundWeight) % 100);

  const heat_score = clamp(
    Math.round(
      baseline * 0.25 +
        vendorGap * 0.2 +
        mailPressure * 0.18 +
        turnoutPressure * 0.17 +
        alertPressure * 0.12 +
        fundraisingPressure * 0.08
    )
  );

  return {
    heat_score,
    pressure: heat_score,
    risk: riskFromHeat(heat_score),

    vendor_score: clamp(100 - vendorGap, 10, 96),
    vendor_gap_score: vendorGap,
    mailops_score: mailPressure,
    turnout_pressure: turnoutPressure,
    alert_pressure: alertPressure,
    fundraising_pressure: fundraisingPressure,

    mail_jobs: Math.max(0, Math.round(mailPressure / 8)),
    alerts: heat_score >= 82 ? 4 : heat_score >= 65 ? 2 : heat_score >= 42 ? 1 : 0,

    scoring_breakdown: {
      baseline,
      battleground_weight: battlegroundWeight,
      vendor_gap_score: vendorGap,
      mailops_score: mailPressure,
      turnout_pressure: turnoutPressure,
      alert_pressure: alertPressure,
      fundraising_pressure: fundraisingPressure,
      heat_score,
    },
  };
}

export function buildTacticalFeed({ stateCode = null, counties = [], limit = 20 }) {
  return counties
    .filter((county) => county.risk === "Critical" || county.risk === "High")
    .sort((a, b) => Number(b.heat_score || b.pressure || 0) - Number(a.heat_score || a.pressure || 0))
    .slice(0, limit)
    .map((county, index) => ({
      id: `${county.full_fips || county.id || index}-tactical-feed`,
      title: `${county.name} tactical pressure ${county.risk.toLowerCase()}`,
      state: stateCode || county.state_code || county.state,
      county: county.name,
      severity: county.risk,
      source: "Tactical Intelligence Engine",
      layer: "County Heat",
      recommendation:
        county.risk === "Critical"
          ? "Immediate escalation recommended. Review vendor coverage, MailOps timing, and deployment readiness."
          : "Monitor closely. Pressure is elevated across operational indicators.",
      heat_score: county.heat_score || county.pressure || 0,
      created_at: new Date().toISOString(),
    }));
}

export function summarizeHeat(counties = []) {
  const total = counties.length;

  const avgHeat = total
    ? Math.round(
        counties.reduce((sum, county) => sum + Number(county.heat_score || county.pressure || 0), 0) /
          total
      )
    : 0;

  return {
    heat_score: avgHeat,
    risk: riskFromHeat(avgHeat),
    critical_counties: counties.filter((county) => county.risk === "Critical").length,
    high_counties: counties.filter((county) => county.risk === "High").length,
    elevated_counties: counties.filter((county) => county.risk === "Elevated").length,
    stable_counties: counties.filter((county) => county.risk === "Stable").length,
    vendor_gap_count: counties.filter((county) => Number(county.vendor_gap_score || 0) >= 55).length,
    total_mail_jobs: counties.reduce((sum, county) => sum + Number(county.mail_jobs || 0), 0),
    total_alerts: counties.reduce((sum, county) => sum + Number(county.alerts || 0), 0),
  };
}
