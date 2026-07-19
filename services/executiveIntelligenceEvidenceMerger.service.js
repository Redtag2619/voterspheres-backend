import crypto from "node:crypto";

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(value = "") {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(
      (key) => url.searchParams.delete(key)
    );
    return url.toString();
  } catch {
    return clean(value);
  }
}

function stableId(item = {}) {
  const source = clean(item.source || item.provider || item.tool || "unknown");
  const url = normalizeUrl(item.url || item.link || item.source_url || "");
  const title = clean(item.title || item.headline || item.name || item.summary || "");
  const published = clean(item.published_at || item.date || item.created_at || "");
  return crypto
    .createHash("sha256")
    .update(`${source}|${url}|${title}|${published}`)
    .digest("hex")
    .slice(0, 24);
}

function normalizeEvidence(item = {}, context = {}) {
  const content = clean(
    item.content ||
      item.summary ||
      item.description ||
      item.snippet ||
      item.text ||
      item.answer ||
      ""
  );

  return {
    id: item.id || stableId(item),
    type: clean(item.type || item.evidence_type || context.type || "intelligence"),
    source: clean(item.source || item.provider || context.source || "VoterSpheres"),
    provider: clean(item.provider || item.source || context.provider || "VoterSpheres"),
    tool: clean(item.tool || context.tool || "unknown"),
    title: clean(item.title || item.headline || item.name || "Untitled intelligence item"),
    content,
    summary: clean(item.summary || item.snippet || content),
    url: normalizeUrl(item.url || item.link || item.source_url || ""),
    published_at:
      item.published_at || item.date || item.created_at || item.updated_at || null,
    candidate_id: item.candidate_id || context.candidate_id || null,
    candidate_name: clean(item.candidate_name || context.candidate_name || ""),
    state: clean(item.state || item.state_code || context.state || ""),
    office: clean(item.office || context.office || ""),
    cycle: clean(item.cycle || context.cycle || ""),
    confidence: Number(item.confidence ?? item.score ?? context.confidence ?? 0),
    verified: Boolean(item.verified ?? item.is_verified ?? false),
    raw: item,
  };
}

function freshnessScore(value) {
  if (!value) return 0.25;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 0.25;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86400000);
  if (ageDays <= 1) return 1;
  if (ageDays <= 7) return 0.9;
  if (ageDays <= 30) return 0.75;
  if (ageDays <= 90) return 0.55;
  if (ageDays <= 365) return 0.35;
  return 0.15;
}

function completenessScore(item) {
  const fields = [item.title, item.content, item.url, item.published_at, item.source];
  return fields.filter(Boolean).length / fields.length;
}

function rankEvidence(item) {
  const confidence = Math.max(0, Math.min(1, Number(item.confidence || 0) / 100));
  const verified = item.verified ? 1 : 0.5;
  return (
    freshnessScore(item.published_at) * 0.35 +
    completenessScore(item) * 0.25 +
    confidence * 0.2 +
    verified * 0.2
  );
}

export function mergeExecutiveEvidence(toolResults = [], context = {}) {
  const normalized = [];

  for (const result of toolResults) {
    if (!result?.ok) continue;

    const payload = result.result;
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.evidence)
        ? payload.evidence
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.results)
            ? payload.results
            : payload
              ? [payload]
              : [];

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      normalized.push(
        normalizeEvidence(item, {
          ...context,
          source: result.provider,
          provider: result.provider,
          tool: result.tool,
        })
      );
    }
  }

  const byFingerprint = new Map();

  for (const item of normalized) {
    const fingerprint = [
      item.url,
      item.title.toLowerCase(),
      item.content.slice(0, 180).toLowerCase(),
    ]
      .filter(Boolean)
      .join("|");

    const key = fingerprint || item.id;
    const existing = byFingerprint.get(key);

    if (!existing || rankEvidence(item) > rankEvidence(existing)) {
      byFingerprint.set(key, item);
    }
  }

  const evidence = [...byFingerprint.values()]
    .map((item) => ({ ...item, relevance_score: Number(rankEvidence(item).toFixed(4)) }))
    .sort((a, b) => b.relevance_score - a.relevance_score);

  const sources = [...new Set(evidence.map((item) => item.source).filter(Boolean))];
  const providerCoverage = [...new Set(evidence.map((item) => item.provider).filter(Boolean))];

  return {
    evidence,
    sources,
    provider_coverage: providerCoverage,
    evidence_count: evidence.length,
    verified_evidence_count: evidence.filter((item) => item.verified).length,
  };
}
