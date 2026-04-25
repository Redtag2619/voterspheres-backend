import { pool } from "../db/pool.js";
import { publishRealtimeEvent } from "../lib/realtime.bus.js";

function n(value) {
  return Number(value || 0);
}

function severityFromScore(score) {
  if (score >= 85) return "Critical";
  if (score >= 65) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

function riskFromScore(score) {
  if (score >= 85) return "Severe";
  if (score >= 65) return "Elevated";
  if (score >= 40) return "Watch";
  return "Monitor";
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[CrossSignal] query fallback:", error.message);
    return [];
  }
}

export async function getCrossSignalIntelligence() {
  const [financeRows, vendorRows, mailopsRows, feedRows] = await Promise.all([
    safeQuery(`
      SELECT
        COALESCE(NULLIF(state, ''), 'Unknown') AS state,
        COALESCE(NULLIF(office, ''), 'Statewide') AS office,
        COUNT(*)::int AS candidates,
        COALESCE(SUM(COALESCE(receipts, 0)), 0)::numeric AS receipts,
        COALESCE(SUM(COALESCE(cash_on_hand, 0)), 0)::numeric AS cash_on_hand
      FROM fundraising_live
      GROUP BY COALESCE(NULLIF(state, ''), 'Unknown'), COALESCE(NULLIF(office, ''), 'Statewide')
    `),

    safeQuery(`
      SELECT
        COALESCE(NULLIF(state, ''), 'Unknown') AS state,
        COUNT(*)::int AS vendors,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'active')::int AS active_vendors,
        COUNT(DISTINCT NULLIF(category, ''))::int AS categories
      FROM vendors
      GROUP BY COALESCE(NULLIF(state, ''), 'Unknown')
    `),

    safeQuery(`
      SELECT
        COALESCE(NULLIF(state, ''), 'Unknown') AS state,
        COUNT(*)::int AS mail_events,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(status, '')) IN ('elevated', 'delayed')
             OR LOWER(COALESCE(severity, '')) = 'high'
        )::int AS mail_risks
      FROM mailops_events
      GROUP BY COALESCE(NULLIF(state, ''), 'Unknown')
    `),

    safeQuery(`
      SELECT
        COALESCE(NULLIF(state, ''), 'Unknown') AS state,
        COUNT(*)::int AS feed_events,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(severity, '')) IN ('high', 'critical')
             OR LOWER(COALESCE(risk, '')) = 'elevated'
        )::int AS high_feed_events
      FROM executive_feed_events
      GROUP BY COALESCE(NULLIF(state, ''), 'Unknown')
    `)
  ]);

  const states = new Map();

  function getState(state) {
    const key = state || "Unknown";
    if (!states.has(key)) {
      states.set(key, {
        state: key,
        offices: new Set(),
        candidates: 0,
        receipts: 0,
        cash_on_hand: 0,
        vendors: 0,
        active_vendors: 0,
        categories: 0,
        mail_events: 0,
        mail_risks: 0,
        feed_events: 0,
        high_feed_events: 0
      });
    }
    return states.get(key);
  }

  for (const row of financeRows) {
    const item = getState(row.state);
    item.offices.add(row.office || "Statewide");
    item.candidates += n(row.candidates);
    item.receipts += n(row.receipts);
    item.cash_on_hand += n(row.cash_on_hand);
  }

  for (const row of vendorRows) {
    const item = getState(row.state);
    item.vendors += n(row.vendors);
    item.active_vendors += n(row.active_vendors);
    item.categories += n(row.categories);
  }

  for (const row of mailopsRows) {
    const item = getState(row.state);
    item.mail_events += n(row.mail_events);
    item.mail_risks += n(row.mail_risks);
  }

  for (const row of feedRows) {
    const item = getState(row.state);
    item.feed_events += n(row.feed_events);
    item.high_feed_events += n(row.high_feed_events);
  }

  const results = Array.from(states.values()).map((item) => {
    const financeScore = Math.min(30, Math.round(item.receipts / 500000));
    const cashScore = Math.min(15, Math.round(item.cash_on_hand / 750000));
    const vendorGapScore = item.vendors === 0 ? 25 : item.vendors < 3 ? 18 : item.categories < 2 ? 10 : 0;
    const mailScore = Math.min(20, item.mail_risks * 8);
    const feedScore = Math.min(20, item.high_feed_events * 7);

    const priority_score = Math.min(
      100,
      financeScore + cashScore + vendorGapScore + mailScore + feedScore
    );

    const recommended_actions = [];

    if (vendorGapScore >= 18) {
      recommended_actions.push("Add backup vendor capacity in this state.");
    }

    if (item.mail_risks > 0) {
      recommended_actions.push("Review MailOps delivery risk and postal escalation plan.");
    }

    if (item.high_feed_events > 0) {
      recommended_actions.push("Review executive feed for high-severity narrative or polling signals.");
    }

    if (item.receipts > 1000000) {
      recommended_actions.push("Monitor finance momentum and opposition fundraising response.");
    }

    return {
      state: item.state,
      offices: Array.from(item.offices),
      priority_score,
      severity: severityFromScore(priority_score),
      risk: riskFromScore(priority_score),
      finance: {
        candidates: item.candidates,
        receipts: item.receipts,
        cash_on_hand: item.cash_on_hand
      },
      vendors: {
        vendors: item.vendors,
        active_vendors: item.active_vendors,
        categories: item.categories,
        coverage_status:
          item.vendors === 0 ? "Gap" : item.vendors < 3 ? "Thin" : "Covered"
      },
      mailops: {
        mail_events: item.mail_events,
        mail_risks: item.mail_risks
      },
      feed: {
        feed_events: item.feed_events,
        high_feed_events: item.high_feed_events
      },
      recommended_actions
    };
  }).sort((a, b) => b.priority_score - a.priority_score);

  return {
    generated_at: new Date().toISOString(),
    summary: {
      states_tracked: results.length,
      critical_states: results.filter((r) => r.severity === "Critical").length,
      high_states: results.filter((r) => r.severity === "High").length,
      vendor_gap_states: results.filter((r) => r.vendors.coverage_status === "Gap").length,
      mailops_risk_states: results.filter((r) => r.mailops.mail_risks > 0).length
    },
    results,
    top_priorities: results.slice(0, 10)
  };
}

export async function dispatchCrossSignalAlerts() {
  const intelligence = await getCrossSignalIntelligence();

  const alerts = intelligence.top_priorities
    .filter((item) => ["Critical", "High"].includes(item.severity))
    .map((item) => ({
      event_type: "cross_signal.priority",
      title: `${item.state} cross-signal priority: ${item.severity}`,
      severity: item.severity,
      source: "Cross-Signal Intelligence",
      state: item.state,
      office: item.offices?.[0] || "Statewide",
      risk: item.risk,
      detail: item.recommended_actions.join(" ") || "Multiple intelligence signals require review.",
      priority_score: item.priority_score
    }));

  for (const alert of alerts) {
    publishRealtimeEvent({
      type: "alert.dispatched",
      channel: "intelligence:global",
      payload: { alert }
    });
  }

  return {
    ok: true,
    dispatched: alerts.length,
    alerts
  };
}
