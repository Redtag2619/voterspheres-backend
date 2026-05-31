function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
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

function signalValue(signals, group, stateCode, countyName) {
  if (!signals?.[group]) return 0;

  const countyKey = signals.keyFor?.(stateCode, countyName);
  const countyValue = countyKey ? signals[group].countyMap?.get(countyKey) : 0;
  const stateValue = signals[group].stateMap?.get(String(stateCode || "").toUpperCase()) || 0;

  return Number(countyValue || 0) + Number(stateValue || 0);
}

export function scoreCountyHeat(row, index = 0, signals = null) {
  const stateCode = String(row.state_code || "").toUpperCase();
  const countyName = row.name;

  const baseline = deterministicBase(row, index);

  const battlegroundWeight = ["AZ", "GA", "MI", "NV", "NC", "PA", "WI"].includes(stateCode) ? 14 : 4;

  const vendorSignal = signalValue(signals, "vendors", stateCode, countyName);
  const mailopsSignal = signalValue(signals, "mailops", stateCode, countyName);
  const taskSignal = signalValue(signals, "tasks", stateCode, countyName);
  const alertSignal = signalValue(signals, "alerts", stateCode, countyName);
  const fundraisingSignal = signalValue(signals, "fundraising", stateCode, countyName);

  const vendorGap = clamp(88 - vendorSignal * 9 + battlegroundWeight * 0.8 + baseline * 0.08);
  const vendorReadiness = clamp(100 - vendorGap, 5, 96);

  const mailPressure = clamp(mailopsSignal * 9 + baseline * 0.42 + battlegroundWeight);
  const turnoutPressure = clamp(baseline * 0.62 + battlegroundWeight * 1.7 + taskSignal * 4);
  const taskPressure = clamp(taskSignal * 12 + baseline * 0.18);
  const alertPressure = clamp(alertSignal * 15 + baseline * 0.16);
  const fundraisingPressure = clamp(fundraisingSignal * 1.8 + baseline * 0.22);

  const heat_score = clamp(
    baseline * 0.18 +
      vendorGap * 0.22 +
      mailPressure * 0.18 +
      turnoutPressure * 0.16 +
      taskPressure * 0.1 +
      alertPressure * 0.1 +
      fundraisingPressure * 0.06
  );

  return {
    heat_score: round2(heat_score),
    pressure: round2(heat_score),
    risk: riskFromHeat(heat_score),

    vendor_score: round2(vendorReadiness),
    vendor_gap_score: round2(vendorGap),
    mailops_score: round2(mailPressure),
    turnout_pressure: round2(turnoutPressure),
    task_pressure: round2(taskPressure),
    alert_pressure: round2(alertPressure),
    fundraising_pressure: round2(fundraisingPressure),

    mail_jobs: Math.max(0, Math.round(mailopsSignal || mailPressure / 10)),
    alerts: Math.max(0, Math.round(alertSignal || alertPressure / 20)),

    live_signal_counts: {
      vendors: vendorSignal,
      mailops: mailopsSignal,
      tasks: taskSignal,
      alerts: alertSignal,
      fundraising: fundraisingSignal,
    },

    top_drivers: [
      { label: "Vendor Gap", value: round2(vendorGap) },
      { label: "MailOps", value: round2(mailPressure) },
      { label: "Turnout", value: round2(turnoutPressure) },
      { label: "Tasks", value: round2(taskPressure) },
      { label: "Alerts", value: round2(alertPressure) },
      { label: "Fundraising", value: round2(fundraisingPressure) },
    ]
      .sort((a, b) => b.value - a.value)
      .slice(0, 3),

    scoring_breakdown: {
      baseline: round2(baseline),
      battleground_weight: round2(battlegroundWeight),
      vendor_gap_score: round2(vendorGap),
      vendor_score: round2(vendorReadiness),
      mailops_score: round2(mailPressure),
      turnout_pressure: round2(turnoutPressure),
      task_pressure: round2(taskPressure),
      alert_pressure: round2(alertPressure),
      fundraising_pressure: round2(fundraisingPressure),
      total_pressure: round2(heat_score),
      heat_score: round2(heat_score),
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
      title: `${county.name} tactical pressure ${String(county.risk || "signal").toLowerCase()}`,
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
      top_drivers: county.top_drivers || [],
      created_at: new Date().toISOString(),
    }));
}

export function summarizeHeat(counties = []) {
  const total = counties.length;

  const avgHeat = total
    ? counties.reduce((sum, county) => sum + Number(county.heat_score || county.pressure || 0), 0) / total
    : 0;

  return {
    heat_score: round2(avgHeat),
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
