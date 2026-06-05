import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function getUserId(user = {}) {
  return user.id || user.user_id || user.sub || null;
}

function clean(value = "") {
  return String(value || "")
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<font\b[^>]*>(.*?)<\/font>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value = "") {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export async function ensureReportExportsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_exports (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      report_id INTEGER NULL,
      export_type TEXT DEFAULT 'client_brief',
      title TEXT NOT NULL,
      status TEXT DEFAULT 'generated',
      export_body TEXT NOT NULL,
      html_body TEXT NULL,
      deck_outline JSONB DEFAULT '[]'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_report_exports_firm
    ON report_exports (firm_id, created_at DESC);
  `);
}

async function getReport({ firmId, reportId }) {
  const result = await pool.query(
    `
      SELECT *
      FROM intelligence_reports
      WHERE id = $1 AND firm_id = $2
      LIMIT 1
    `,
    [reportId, firmId]
  );

  if (!result.rows[0]) throw new Error("Intelligence report not found.");
  return result.rows[0];
}

function buildClientBrief(report) {
  const lines = [];
  lines.push(`# ${report.title}`);
  lines.push("");
  lines.push("## Client Brief");
  lines.push(clean(report.executive_summary || "No executive summary available."));
  lines.push("");
  lines.push("## Full Intelligence Report");
  lines.push(report.report_body || "");
  lines.push("");
  lines.push("## Consultant Delivery Notes");
  lines.push("- Review this brief with the client during the next strategy call.");
  lines.push("- Confirm any action items that require client approval.");
  lines.push("- Generate a follow-up report after major new signals or campaign developments.");
  return lines.join("\n");
}

function buildDonorMemo(report) {
  const sections = report.sections || {};
  const signals = Array.isArray(sections.signals) ? sections.signals : [];
  const recommendations = Array.isArray(sections.recommended_actions)
    ? sections.recommended_actions
    : [];

  const lines = [];
  lines.push(`# Donor Memo: ${report.title}`);
  lines.push("");
  lines.push("## Situation Overview");
  lines.push(clean(report.executive_summary || "Current campaign environment requires continued monitoring."));
  lines.push("");
  lines.push("## Why Donors Should Pay Attention");
  if (signals.length) {
    signals.slice(0, 5).forEach((signal, index) => {
      lines.push(`${index + 1}. ${clean(signal.title || "Political signal")} — ${signal.state || "National"} • ${signal.risk || "Signal"}`);
    });
  } else {
    lines.push("No major donor-facing signal spikes detected.");
  }
  lines.push("");
  lines.push("## Recommended Donor Conversation");
  if (recommendations.length) {
    recommendations.slice(0, 5).forEach((item, index) => {
      lines.push(`${index + 1}. ${clean(item.title || item.expected_impact || "Review campaign priority.")}`);
    });
  } else {
    lines.push("Continue reinforcing campaign momentum, urgency, and path to victory.");
  }
  return lines.join("\n");
}

function buildSituationReport(report) {
  const lines = [];
  lines.push(`# Campaign Situation Report`);
  lines.push("");
  lines.push(`Report Source: ${report.title}`);
  lines.push(`Scope: ${report.state || "National"}`);
  lines.push("");
  lines.push(report.report_body || "");
  lines.push("");
  lines.push("## Situation Report Closeout");
  lines.push("Use this document for internal staff alignment, principal briefing, and rapid response coordination.");
  return lines.join("\n");
}

function buildDeckOutline(report) {
  const sections = report.sections || {};
  const recommendations = Array.isArray(sections.recommended_actions)
    ? sections.recommended_actions
    : [];
  const signals = Array.isArray(sections.signals) ? sections.signals : [];
  const tasks = Array.isArray(sections.tasks) ? sections.tasks : [];

  return [
    {
      slide: 1,
      title: report.title,
      bullets: [
        `${titleCase(report.report_type)} briefing`,
        `Scope: ${report.state || "National"}`,
        "Prepared by VoterSpheres",
      ],
    },
    {
      slide: 2,
      title: "Executive Summary",
      bullets: [clean(report.executive_summary || "Campaign intelligence summary.")],
    },
    {
      slide: 3,
      title: "Strategic Recommendations",
      bullets: recommendations.slice(0, 5).map((item) => clean(item.title || item.expected_impact || "Review priority.")),
    },
    {
      slide: 4,
      title: "Political Signal Watch",
      bullets: signals.slice(0, 5).map((item) => `${clean(item.title || "Signal")} — ${item.state || "National"} • ${item.risk || "Signal"}`),
    },
    {
      slide: 5,
      title: "Execution Priorities",
      bullets: tasks.slice(0, 5).map((item) => `${clean(item.title || "Task")} — ${item.priority || "Medium"} • ${item.status || "Open"}`),
    },
    {
      slide: 6,
      title: "Next Steps",
      bullets: [
        "Assign owners to urgent recommendations.",
        "Review signal changes within 24 hours.",
        "Generate follow-up client brief after major movement.",
      ],
    },
  ];
}

function buildHtml(title, body) {
  const escaped = clean(body)
    .split("\n")
    .map((line) => {
      if (line.startsWith("# ")) return `<h1>${clean(line.replace("# ", ""))}</h1>`;
      if (line.startsWith("## ")) return `<h2>${clean(line.replace("## ", ""))}</h2>`;
      if (line.startsWith("- ")) return `<li>${clean(line.replace("- ", ""))}</li>`;
      if (/^\d+\./.test(line)) return `<p class="numbered">${clean(line)}</p>`;
      if (!line.trim()) return `<br />`;
      return `<p>${clean(line)}</p>`;
    })
    .join("\n");

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${clean(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 48px; color: #111827; line-height: 1.55; }
    h1 { font-size: 30px; margin-bottom: 12px; }
    h2 { font-size: 19px; margin-top: 28px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
    p, li { font-size: 13px; }
    .numbered { padding: 8px 10px; background: #f8fafc; border-left: 3px solid #2563eb; }
    .footer { margin-top: 40px; font-size: 11px; color: #6b7280; }
  </style>
</head>
<body>
  ${escaped}
  <div class="footer">Generated by VoterSpheres Report Export Engine</div>
</body>
</html>`;
}

export async function generateReportExport({ user = {}, payload = {} }) {
  await ensureReportExportsTable();

  const firmId = getFirmId(user);
  const userId = getUserId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const reportId = payload.report_id;
  if (!reportId) throw new Error("report_id is required.");

  const report = await getReport({ firmId, reportId });
  const exportType = payload.export_type || "client_brief";

  let exportBody;
  if (exportType === "donor_memo") exportBody = buildDonorMemo(report);
  else if (exportType === "situation_report") exportBody = buildSituationReport(report);
  else exportBody = buildClientBrief(report);

  const deckOutline = buildDeckOutline(report);
  const title = payload.title || `${titleCase(exportType)} - ${report.title}`;
  const htmlBody = buildHtml(title, exportBody);

  const result = await pool.query(
    `
      INSERT INTO report_exports (
        firm_id, report_id, export_type, title, status,
        export_body, html_body, deck_outline, metadata,
        created_by, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,'generated',$5,$6,$7::jsonb,$8::jsonb,$9,NOW(),NOW())
      RETURNING *
    `,
    [
      firmId,
      reportId,
      exportType,
      title,
      exportBody,
      htmlBody,
      JSON.stringify(deckOutline),
      JSON.stringify({
        source_report_title: report.title,
        source_report_type: report.report_type,
        source_report_state: report.state,
      }),
      userId,
    ]
  );

  return result.rows[0];
}

export async function listReportExports({ user = {}, limit = 50 }) {
  await ensureReportExportsTable();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const result = await pool.query(
    `
      SELECT id, firm_id, report_id, export_type, title, status,
             metadata, created_at, updated_at
      FROM report_exports
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [firmId, Number(limit || 50)]
  );

  return result.rows;
}

export async function getReportExport({ user = {}, id }) {
  await ensureReportExportsTable();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const result = await pool.query(
    `
      SELECT *
      FROM report_exports
      WHERE id = $1 AND firm_id = $2
      LIMIT 1
    `,
    [id, firmId]
  );

  if (!result.rows[0]) throw new Error("Report export not found.");
  return result.rows[0];
}

export async function deleteReportExport({ user = {}, id }) {
  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  await pool.query(
    `
      DELETE FROM report_exports
      WHERE id = $1 AND firm_id = $2
    `,
    [id, firmId]
  );

  return { ok: true };
}
