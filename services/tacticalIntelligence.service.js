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
  const stateCode = String(row.state_code || "").toUpperCase();

  const stateSeed =
    stateCode
      .split("")
      .reduce((sum, char) => sum + char.charCodeAt(0), 0) || 10;

  const countySeed = Number(row.county_fips || 0);

  const battlegroundBase = ["AZ", "GA", "MI", "NV", "NC", "PA", "WI"].includes(stateCode)
    ? 42
    : 26;

  return clamp(
    battlegroundBase + ((stateSeed * 3 + countySeed * 5 + index * 9) % 48),
    22,
    94
  );
}

function signalValue(signals, group, stateCode, countyName) {
  if (!signals?.[group]) return 0;

  const countyKey = signals.keyFor?.(stateCode, countyName);
  const countyValue = countyKey ? signals[group].countyMap?.get(countyKey) : 0;
  const stateValue = signals[group].stateMap?.get(String(stateCode || "").toUpperCase()) || 0;

  return Number(countyValue || 0) + Number(stateValue || 0);
}

function countyTaskStatus(signals, stateCode, countyName) {
  const countyKey = signals?.keyFor?.(stateCode, countyName);

  if (!countyKey) {
    return {
      activeTaskCount: 0,
      resolvedTaskCount: 0,
      command_status: "No Task",
      task_active: false,
      task_resolved: false,
    };
  }

  const activeTaskCount = Number(signals?.tasks?.activeCountyTasks?.get(countyKey) || 0);
  const resolvedTaskCount = Number(signals?.tasks?.resolvedCountyTasks?.get(countyKey) || 0);

  return {
    activeTaskCount,
    resolvedTaskCount,
    command_status: activeTaskCount > 0 ? "Task Active" : resolvedTaskCount > 0 ? "Resolved" : "No Task",
    task_active: activeTaskCount > 0,
    task_resolved: activeTaskCount === 0 && resolvedTaskCount > 0,
  };
}

function dataCoverageScore({ vendorSignal, mailopsSignal, taskSignal, alertSignal, fundraisingSignal }) {
  return clamp(
    vendorSignal * 8 +
      mailopsSignal * 8 +
      taskSignal * 10 +
      alertSignal * 12 +
      fundraisingSignal * 2,
    0,
    100
  );
}

export function scoreCountyHeat(row, index = 0, signals = null) {
  const stateCode = String(row.state_code || "").toUpperCase();
  const countyName = row.name;

  const baseline = deterministicBase(row, index);
  const taskStatus = countyTaskStatus(signals, stateCode, countyName);

  const battlegroundWeight = ["AZ", "GA", "MI", "NV", "NC", "PA", "WI"].includes(stateCode) ? 18 : 7;

  const vendorSignal = signalValue(signals, "vendors", stateCode, countyName);
  const mailopsSignal = signalValue(signals, "mailops", stateCode, countyName);
  const taskSignalRaw = signalValue(signals, "tasks", stateCode, countyName);
  const alertSignal = signalValue(signals, "alerts", stateCode, countyName);
  const fundraisingSignal = signalValue(signals, "fundraising", stateCode, countyName);

  const coverage = dataCoverageScore({
    vendorSignal,
    mailopsSignal,
    taskSignal: taskSignalRaw,
    alertSignal,
    fundraisingSignal,
  });

  const sparseDataBoost = coverage < 10 ? 8 : 0;
  const resolvedRelief = taskStatus.task_resolved ? 16 : 0;
  const activeTaskBoost = taskStatus.task_active ? 24 : 0;
  const taskSignal = Math.max(0, taskSignalRaw);

  const vendorGap = clamp(
    74 -
      vendorSignal * 7 +
      battlegroundWeight * 0.95 +
      baseline * 0.16 +
      sparseDataBoost -
      resolvedRelief * 0.3
  );

  const vendorReadiness = clamp(100 - vendorGap, 5, 96);

  const mailPressure = clamp(
    mailopsSignal * 11 +
      baseline * 0.5 +
      battlegroundWeight +
      sparseDataBoost -
      resolvedRelief * 0.2
  );

  const turnoutPressure = clamp(
    baseline * 0.72 +
      battlegroundWeight * 1.8 +
      taskSignal * 5 +
      activeTaskBoost -
      resolvedRelief * 0.25
  );

  const taskPressure = clamp(
    taskSignal * 14 +
      baseline * 0.28 +
      activeTaskBoost -
      resolvedRelief
  );

  const alertPressure = clamp(
    alertSignal * 18 +
      baseline * 0.24 +
      sparseDataBoost -
      resolvedRelief * 0.2
  );

  const fundraisingPressure = clamp(
    fundraisingSignal * 2.4 +
      baseline * 0.3 +
      battlegroundWeight * 0.4
  );

  const heatBeforeResolution = clamp(
    baseline * 0.16 +
      vendorGap * 0.2 +
      mailPressure * 0.18 +
      turnoutPressure * 0.18 +
      taskPressure * 0.14 +
      alertPressure * 0.1 +
      fundraisingPressure * 0.04
  );

  const heat_score = clamp(heatBeforeResolution - resolvedRelief * 0.65);

  return {
    heat_score: round2(heat_score),
    pressure: round2(heat_score),
    risk: riskFromHeat(heat_score),

    data_coverage_score: round2(coverage),
    data_coverage_label: coverage >= 45 ? "Live Rich" : coverage >= 15 ? "Partial Live" : "Sparse Live",

    command_status: taskStatus.command_status,
    task_active: taskStatus.task_active,
    task_resolved: taskStatus.task_resolved,
    active_task_count: taskStatus.activeTaskCount,
    resolved_task_count: taskStatus.resolvedTaskCount,

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
      active_county_tasks: taskStatus.activeTaskCount,
      resolved_county_tasks: taskStatus.resolvedTaskCount,
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
      sparse_data_boost: round2(sparseDataBoost),
      resolved_task_relief: round2(resolvedRelief),
      active_task_boost: round2(activeTaskBoost),
      data_coverage_score: round2(coverage),
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
    .filter((county) => county.risk === "Critical" || county.risk === "High" || county.task_active)
    .sort((a, b) => Number(b.heat_score || b.pressure || 0) - Number(a.heat_score || a.pressure || 0))
    .slice(0, limit)
    .map((county, index) => ({
      id: `${county.full_fips || county.id || index}-tactical-feed`,
      title: county.task_active
        ? `${county.name} has active command escalation`
        : `${county.name} tactical pressure ${String(county.risk || "signal").toLowerCase()}`,
      state: stateCode || county.state_code || county.state,
      county: county.name,
      severity: county.task_active ? "High" : county.risk,
      source: "Tactical Intelligence Engine",
      layer: "County Heat",
      recommendation:
        county.task_active
          ? "Command task is active. Track owner progress and complete once pressure has been addressed."
          : county.risk === "Critical"
            ? "Immediate escalation recommended. Review vendor coverage, MailOps timing, and deployment readiness."
            : "Monitor closely. Pressure is elevated across operational indicators.",
      heat_score: county.heat_score || county.pressure || 0,
      command_status: county.command_status,
      data_coverage_label: county.data_coverage_label,
      top_drivers: county.top_drivers || [],
      created_at: new Date().toISOString(),
    }));
}

export function summarizeHeat(counties = []) {
  const total = counties.length;

  const avgHeat = total
    ? counties.reduce((sum, county) => sum + Number(county.heat_score || county.pressure || 0), 0) / total
    : 0;

  const maxHeat = total
    ? Math.max(...counties.map((county) => Number(county.heat_score || county.pressure || 0)))
    : 0;

  const urgentCount = counties.filter((county) =>
    ["Critical", "High"].includes(county.risk)
  ).length;

  const activeTaskCount = counties.reduce((sum, county) => sum + Number(county.active_task_count || 0), 0);
  const resolvedTaskCount = counties.reduce((sum, county) => sum + Number(county.resolved_task_count || 0), 0);

  const avgCoverage = total
    ? counties.reduce((sum, county) => sum + Number(county.data_coverage_score || 0), 0) / total
    : 0;

  let blendedHeat = avgHeat * 0.58 + maxHeat * 0.32 + Math.min(20, urgentCount * 2.5);

  if (activeTaskCount > 0) blendedHeat = Math.max(blendedHeat, 68 + Math.min(18, activeTaskCount * 3));
  if (maxHeat >= 82) blendedHeat = Math.max(blendedHeat, 72);
  if (resolvedTaskCount > 0 && activeTaskCount === 0) blendedHeat = Math.max(20, blendedHeat - 6);

  const finalHeat = clamp(blendedHeat, 0, 100);

  return {
    heat_score: round2(finalHeat),
    average_heat_score: round2(avgHeat),
    max_county_heat_score: round2(maxHeat),
    risk: riskFromHeat(finalHeat),

    data_coverage_score: round2(avgCoverage),
    data_coverage_label: avgCoverage >= 45 ? "Live Rich" : avgCoverage >= 15 ? "Partial Live" : "Sparse Live",

    critical_counties: counties.filter((county) => county.risk === "Critical").length,
    high_counties: counties.filter((county) => county.risk === "High").length,
    elevated_counties: counties.filter((county) => county.risk === "Elevated").length,
    stable_counties: counties.filter((county) => county.risk === "Stable").length,

    active_task_count: activeTaskCount,
    resolved_task_count: resolvedTaskCount,
    vendor_gap_count: counties.filter((county) => Number(county.vendor_gap_score || 0) >= 55).length,
    total_mail_jobs: counties.reduce((sum, county) => sum + Number(county.mail_jobs || 0), 0),
    total_alerts: counties.reduce((sum, county) => sum + Number(county.alerts || 0), 0),
  };
}
