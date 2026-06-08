import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function clean(value = "") {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[universal-search] skipped query:", error.message);
    return [];
  }
}

function result({
  id,
  type,
  title,
  subtitle = "",
  description = "",
  state = "National",
  path = "/national-command",
  priority = "normal",
  metadata = {},
}) {
  return {
    id: `${type}-${id}`,
    source_id: id,
    type,
    title: clean(title || `${type} result`),
    subtitle: clean(subtitle),
    description: clean(description),
    state: state || "National",
    path,
    priority,
    metadata,
  };
}

function priorityFrom(value = "") {
  const v = String(value || "").toLowerCase();
  if (["critical", "high", "blocked", "overdue", "at risk"].some((x) => v.includes(x))) return "high";
  if (["watch", "medium", "elevated", "open", "pending"].some((x) => v.includes(x))) return "medium";
  return "normal";
}

function matchScore(row, q) {
  if (!q) return 1;

  const text = [
    row.title,
    row.subtitle,
    row.description,
    row.state,
    row.type,
    JSON.stringify(row.metadata || {}),
  ]
    .join(" ")
    .toLowerCase();

  const query = q.toLowerCase();
  if (String(row.title || "").toLowerCase().includes(query)) return 100;
  if (String(row.subtitle || "").toLowerCase().includes(query)) return 80;
  if (text.includes(query)) return 60;

  const terms = query.split(/\s+/).filter(Boolean);
  return terms.reduce((score, term) => score + (text.includes(term) ? 10 : 0), 0);
}

export async function universalSearch({ user = {}, q = "", type = "", state = "", limit = 120 }) {
  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const query = clean(q);
  const like = `%${query}%`;
  const hardLimit = Math.min(Number(limit || 120), 200);

  const workspaceRows = await safeQuery(
    `
      SELECT id, name, campaign_name, title, state, office, cycle, status
      FROM workspaces
      WHERE firm_id = $1
        AND (
          $2 = ''
          OR name ILIKE $3
          OR campaign_name ILIKE $3
          OR title ILIKE $3
          OR state ILIKE $3
          OR office ILIKE $3
          OR status ILIKE $3
        )
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 40
    `,
    [firmId, query, like]
  );

  const candidateRows = await safeQuery(
    `
      SELECT id, full_name, name, office, state, state_code, party, election_year, slug
      FROM candidates
      WHERE
        $1 = ''
        OR full_name ILIKE $2
        OR name ILIKE $2
        OR office ILIKE $2
        OR state ILIKE $2
        OR state_code ILIKE $2
        OR party ILIKE $2
      ORDER BY election_year DESC NULLS LAST, full_name ASC NULLS LAST
      LIMIT 50
    `,
    [query, like]
  );

  const taskRows = await safeQuery(
    `
      SELECT id, title, description, status, priority, state, workspace_id, source
      FROM tasks
      WHERE firm_id = $1
        AND (
          $2 = ''
          OR title ILIKE $3
          OR description ILIKE $3
          OR status ILIKE $3
          OR priority ILIKE $3
          OR state ILIKE $3
          OR source ILIKE $3
        )
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 50
    `,
    [firmId, query, like]
  );

  const signalRows = await safeQuery(
    `
      SELECT id, title, summary, state, signal_type, risk, severity, signal_score, workspace_id
      FROM political_signals
      WHERE firm_id = $1
        AND (
          $2 = ''
          OR title ILIKE $3
          OR summary ILIKE $3
          OR state ILIKE $3
          OR signal_type ILIKE $3
          OR risk ILIKE $3
          OR severity ILIKE $3
        )
      ORDER BY signal_score DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 50
    `,
    [firmId, query, like]
  );

  const vendorRows = await safeQuery(
    `
      SELECT id, name, vendor_name, category, state, status, risk, coverage_tier
      FROM vendors
      WHERE firm_id = $1
        AND (
          $2 = ''
          OR name ILIKE $3
          OR vendor_name ILIKE $3
          OR category ILIKE $3
          OR state ILIKE $3
          OR status ILIKE $3
          OR risk ILIKE $3
          OR coverage_tier ILIKE $3
        )
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 50
    `,
    [firmId, query, like]
  );

  const reportRows = await safeQuery(
    `
      SELECT id, title, report_type, state, status, executive_summary
      FROM intelligence_reports
      WHERE firm_id = $1
        AND (
          $2 = ''
          OR title ILIKE $3
          OR report_type ILIKE $3
          OR state ILIKE $3
          OR status ILIKE $3
          OR executive_summary ILIKE $3
        )
      ORDER BY created_at DESC
      LIMIT 50
    `,
    [firmId, query, like]
  );

  const clientRows = await safeQuery(
    `
      SELECT id, client_name, organization, state, status, health_status, monthly_retainer
      FROM consultant_clients
      WHERE firm_id = $1
        AND (
          $2 = ''
          OR client_name ILIKE $3
          OR organization ILIKE $3
          OR state ILIKE $3
          OR status ILIKE $3
          OR health_status ILIKE $3
        )
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 50
    `,
    [firmId, query, like]
  );

  const crmRows = await safeQuery(
    `
      SELECT id, full_name, organization, role_type, state, workspace_id
      FROM campaign_crm_contacts
      WHERE firm_id = $1
        AND (
          $2 = ''
          OR full_name ILIKE $3
          OR organization ILIKE $3
          OR role_type ILIKE $3
          OR state ILIKE $3
        )
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 50
    `,
    [firmId, query, like]
  );

  const alertRows = await safeQuery(
    `
      SELECT id, source, category, level, title, body, state, source_path, created_at
      FROM notification_events
      WHERE firm_id = $1
        AND archived_at IS NULL
        AND (
          $2 = ''
          OR title ILIKE $3
          OR body ILIKE $3
          OR source ILIKE $3
          OR category ILIKE $3
          OR level ILIKE $3
          OR state ILIKE $3
        )
      ORDER BY created_at DESC
      LIMIT 50
    `,
    [firmId, query, like]
  );

  let results = [
    ...workspaceRows.map((w) =>
      result({
        id: w.id,
        type: "workspace",
        title: w.name || w.campaign_name || w.title || `Workspace ${w.id}`,
        subtitle: `${w.state || "National"} • ${w.office || "Campaign"} • ${w.cycle || "Cycle"}`,
        description: `Workspace status: ${w.status || "active"}`,
        state: w.state || "National",
        path: `/executive-workspace?workspace_id=${w.id}`,
        priority: priorityFrom(w.status),
        metadata: w,
      })
    ),

    ...candidateRows.map((c) =>
      result({
        id: c.id,
        type: "candidate",
        title: c.full_name || c.name || `Candidate ${c.id}`,
        subtitle: `${c.office || "Office"} • ${c.state || c.state_code || "State"} • ${c.party || "Party"}`,
        description: `${c.election_year || "Cycle"} candidate record`,
        state: c.state || c.state_code || "National",
        path: `/candidates?id=${c.id}`,
        priority: "normal",
        metadata: c,
      })
    ),

    ...taskRows.map((t) =>
      result({
        id: t.id,
        type: "task",
        title: t.title || `Task ${t.id}`,
        subtitle: `${t.status || "Open"} • ${t.priority || "Normal"} • ${t.source || "Task"}`,
        description: t.description || "Execution task",
        state: t.state || "National",
        path: "/command-center",
        priority: priorityFrom(t.priority || t.status),
        metadata: t,
      })
    ),

    ...signalRows.map((s) =>
      result({
        id: s.id,
        type: "signal",
        title: s.title || `Signal ${s.id}`,
        subtitle: `${s.state || "National"} • ${s.signal_type || "Political Signal"} • Score ${s.signal_score || 0}`,
        description: s.summary || "Political signal",
        state: s.state || "National",
        path: "/political-intelligence",
        priority: priorityFrom(s.risk || s.severity || s.signal_score),
        metadata: s,
      })
    ),

    ...vendorRows.map((v) =>
      result({
        id: v.id,
        type: "vendor",
        title: v.name || v.vendor_name || `Vendor ${v.id}`,
        subtitle: `${v.category || "Vendor"} • ${v.state || "National"}`,
        description: `${v.status || "active"} • ${v.risk || v.coverage_tier || "stable"}`,
        state: v.state || "National",
        path: "/vendors",
        priority: priorityFrom(v.risk || v.coverage_tier),
        metadata: v,
      })
    ),

    ...reportRows.map((r) =>
      result({
        id: r.id,
        type: "report",
        title: r.title || `Report ${r.id}`,
        subtitle: `${r.report_type || "Report"} • ${r.state || "National"} • ${r.status || "Generated"}`,
        description: r.executive_summary || "Intelligence report",
        state: r.state || "National",
        path: "/intelligence-reports",
        priority: "normal",
        metadata: r,
      })
    ),

    ...clientRows.map((c) =>
      result({
        id: c.id,
        type: "client",
        title: c.client_name || `Client ${c.id}`,
        subtitle: `${c.organization || "Client"} • ${c.state || "National"}`,
        description: `${c.status || "active"} • ${c.health_status || "stable"}`,
        state: c.state || "National",
        path: "/business-suite",
        priority: priorityFrom(c.health_status),
        metadata: c,
      })
    ),

    ...crmRows.map((c) =>
      result({
        id: c.id,
        type: "crm",
        title: c.full_name || `CRM Contact ${c.id}`,
        subtitle: `${c.organization || "Organization"} • ${c.role_type || "Contact"}`,
        description: `${c.state || "National"} CRM contact`,
        state: c.state || "National",
        path: "/campaign-crm",
        priority: "normal",
        metadata: c,
      })
    ),

    ...alertRows.map((a) =>
      result({
        id: a.id,
        type: "alert",
        title: a.title || `Alert ${a.id}`,
        subtitle: `${a.source || "Alert"} • ${a.level || "info"} • ${a.category || "general"}`,
        description: a.body || "Notification alert",
        state: a.state || "National",
        path: a.source_path || "/notifications",
        priority: priorityFrom(a.level),
        metadata: a,
      })
    ),
  ];

  if (state) results = results.filter((r) => r.state === state || r.state === "National");
  if (type) results = results.filter((r) => r.type === type);

  results = results
    .map((row) => ({ ...row, score: matchScore(row, query) }))
    .filter((row) => !query || row.score > 0)
    .sort((a, b) => {
      const priorityWeight = { high: 3, medium: 2, normal: 1 };
      return (
        b.score - a.score ||
        (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0)
      );
    })
    .slice(0, hardLimit);

  const type_counts = results.reduce((acc, row) => {
    acc[row.type] = (acc[row.type] || 0) + 1;
    return acc;
  }, {});

  return {
    query,
    results,
    type_counts,
    summary: {
      total: results.length,
      high_priority: results.filter((r) => r.priority === "high").length,
      medium_priority: results.filter((r) => r.priority === "medium").length,
      types: Object.keys(type_counts).length,
    },
    states: Array.from(new Set(results.map((r) => r.state).filter(Boolean))).sort(),
    updated_at: new Date().toISOString(),
  };
}
