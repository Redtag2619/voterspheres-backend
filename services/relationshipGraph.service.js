import pool from "../config/database.js";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function first(...values) {
  for (const value of values) {
    const next = clean(value);
    if (next) return next;
  }
  return "";
}

function getDefaultCycle() {
  return Number(process.env.FEC_DEFAULT_CYCLE || 2026);
}

function moneyLabel(value) {
  const amount = num(value);
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function nodeId(type, value) {
  return `${type}-${String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function edgeId(source, target, type) {
  return `${source}->${target}:${type}`;
}

function getState(row = {}) {
  return first(row.candidate_state, row.state, row.state_code, row.coverage_state).toUpperCase();
}

function getParty(row = {}) {
  return first(row.candidate_party, row.party, row.party_affiliation);
}

function getOffice(row = {}) {
  return first(row.candidate_office, row.office);
}

function influenceFromAmount(amount, base = 35) {
  const value = num(amount);
  if (!value) return base;
  return Math.min(100, Math.round(base + Math.log10(Math.max(value, 1)) * 8));
}

function strengthFromAmount(amount, transactions = 1) {
  const value = num(amount);
  const count = num(transactions, 1);
  const score = Math.log10(Math.max(value, 1)) * 12 + Math.min(25, count * 2);
  return Math.min(100, Math.max(20, Math.round(score)));
}

function addNode(map, node) {
  const existing = map.get(node.id);

  if (!existing) {
    map.set(node.id, node);
    return;
  }

  map.set(node.id, {
    ...existing,
    ...node,
    influence: Math.max(num(existing.influence), num(node.influence)),
    total_amount: num(existing.total_amount) + num(node.total_amount),
    relationship_count: num(existing.relationship_count) + num(node.relationship_count),
    raw: {
      ...(existing.raw || {}),
      ...(node.raw || {}),
    },
  });
}

function addLink(map, link) {
  const id = link.id || edgeId(link.source, link.target, link.type);
  const existing = map.get(id);

  if (!existing) {
    map.set(id, { ...link, id });
    return;
  }

  map.set(id, {
    ...existing,
    ...link,
    amount: num(existing.amount) + num(link.amount),
    strength: Math.max(num(existing.strength), num(link.strength)),
    transaction_count: num(existing.transaction_count) + num(link.transaction_count),
  });
}

async function querySafe(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("Relationship graph query fallback:", error.message);
    return [];
  }
}

async function fetchRelationshipRows(options = {}) {
  const cycle = num(options.cycle, getDefaultCycle());
  const limit = Math.min(Math.max(num(options.limit, 100), 10), 1000);
  const state = clean(options.state).toUpperCase();
  const party = clean(options.party);
  const office = clean(options.office);
  const search = clean(options.search);
  const committee = clean(options.committee);
  const consultant = clean(options.consultant);
  const candidate = clean(options.candidate);
  const minAmount = num(options.minAmount || options.min_amount, 0);

  const params = [cycle];
  const where = ["r.cycle = $1"];

  if (state) {
    params.push(state);
    where.push(`UPPER(COALESCE(r.candidate_state, '')) = $${params.length}`);
  }

  if (party) {
    params.push(`%${party}%`);
    where.push(`COALESCE(r.candidate_party, '') ILIKE $${params.length}`);
  }

  if (office) {
    params.push(`%${office}%`);
    where.push(`COALESCE(r.candidate_office, '') ILIKE $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    where.push(`(
      r.committee_name ILIKE $${params.length}
      OR r.committee_id ILIKE $${params.length}
      OR r.candidate_name ILIKE $${params.length}
      OR c.name ILIKE $${params.length}
      OR c.firm_name ILIKE $${params.length}
    )`);
  }

  if (committee) {
    params.push(`%${committee}%`);
    where.push(`(
      r.committee_name ILIKE $${params.length}
      OR r.committee_id ILIKE $${params.length}
    )`);
  }

  if (consultant) {
    params.push(`%${consultant}%`);
    where.push(`(
      c.name ILIKE $${params.length}
      OR c.firm_name ILIKE $${params.length}
    )`);
  }

  if (candidate) {
    params.push(`%${candidate}%`);
    where.push(`r.candidate_name ILIKE $${params.length}`);
  }

  if (minAmount > 0) {
    params.push(minAmount);
    where.push(`COALESCE(r.total_amount, 0) >= $${params.length}`);
  }

  params.push(limit);
  const limitParam = params.length;

  return querySafe(
    `
      SELECT
        r.id AS relationship_id,
        r.cycle,
        r.committee_id,
        COALESCE(NULLIF(TRIM(r.committee_name), ''), r.committee_id, 'Unknown Committee') AS committee_name,

        r.consultant_id,
        COALESCE(NULLIF(TRIM(c.name), ''), NULLIF(TRIM(c.firm_name), ''), 'Unknown Consultant') AS consultant_name,
        c.firm_name,
        c.category AS consultant_category,
        c.state AS consultant_state,
        c.website AS consultant_website,
        c.email AS consultant_email,
        c.phone AS consultant_phone,
        c.influence_score,
        c.exposure_score,
        c.risk_label,

        r.candidate_id,
        COALESCE(NULLIF(TRIM(r.candidate_name), ''), 'Unknown Candidate') AS candidate_name,
        r.candidate_state,
        r.candidate_party,
        r.candidate_office,

        r.category AS relationship_category,
        COALESCE(r.total_amount, 0)::numeric AS total_amount,
        COALESCE(r.transaction_count, 0)::int AS transaction_count,
        r.last_disbursement_date,
        r.confidence,
        r.purpose,
        r.updated_at
      FROM consultant_candidate_relationships r
      LEFT JOIN consultants c ON c.id = r.consultant_id
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(r.total_amount, 0) DESC, COALESCE(r.transaction_count, 0) DESC
      LIMIT $${limitParam}
    `,
    params
  );
}

function buildGraphFromRelationships(rows = []) {
  const nodes = new Map();
  const links = new Map();

  for (const row of rows) {
    const committeeKey = row.committee_id || row.committee_name;
    const consultantKey = row.consultant_id || row.consultant_name;
    const candidateKey = row.candidate_id || row.candidate_name;

    const committeeNodeId = nodeId("committee", committeeKey);
    const consultantNodeId = nodeId("consultant", consultantKey);
    const candidateNodeId = nodeId("candidate", candidateKey);

    const amount = num(row.total_amount);
    const transactions = num(row.transaction_count, 1);
    const strength = strengthFromAmount(amount, transactions);

    addNode(nodes, {
      id: committeeNodeId,
      source_id: row.committee_id,
      type: "committee",
      label: row.committee_name || row.committee_id || "Committee",
      subtitle: `${row.committee_id || "Committee"} • ${moneyLabel(amount)}`,
      state: getState(row),
      party: getParty(row),
      influence: influenceFromAmount(amount, 45),
      total_amount: amount,
      relationship_count: 1,
      raw: {
        committee_id: row.committee_id,
        committee_name: row.committee_name,
        cycle: row.cycle,
        total_amount: amount,
        transaction_count: transactions,
      },
    });

    addNode(nodes, {
      id: consultantNodeId,
      source_id: row.consultant_id,
      type: "consultant",
      label: row.consultant_name || row.firm_name || "Consultant",
      subtitle: first(row.consultant_category, row.consultant_state, "Political Consulting"),
      state: first(row.consultant_state, getState(row)),
      party: getParty(row),
      influence: Math.max(num(row.influence_score), influenceFromAmount(amount, 40)),
      total_amount: amount,
      relationship_count: 1,
      raw: {
        id: row.consultant_id,
        name: row.consultant_name,
        firm_name: row.firm_name,
        category: row.consultant_category,
        state: row.consultant_state,
        website: row.consultant_website,
        email: row.consultant_email,
        phone: row.consultant_phone,
        influence_score: row.influence_score,
        exposure_score: row.exposure_score,
        risk_label: row.risk_label,
      },
    });

    addNode(nodes, {
      id: candidateNodeId,
      source_id: row.candidate_id,
      type: "candidate",
      label: row.candidate_name || "Candidate",
      subtitle: `${first(row.candidate_state, "State N/A")} • ${first(row.candidate_office, "Office N/A")}`,
      state: getState(row),
      party: getParty(row),
      influence: influenceFromAmount(amount, 38),
      total_amount: amount,
      relationship_count: 1,
      raw: {
        id: row.candidate_id,
        name: row.candidate_name,
        full_name: row.candidate_name,
        state: row.candidate_state,
        party: row.candidate_party,
        office: row.candidate_office,
        total_amount: amount,
        transaction_count: transactions,
      },
    });

    addLink(links, {
      source: committeeNodeId,
      target: consultantNodeId,
      type: "committee_consultant",
      label: "Committee paid consultant",
      strength,
      amount,
      transaction_count: transactions,
      raw: {
        relationship_id: row.relationship_id,
        category: row.relationship_category,
        purpose: row.purpose,
        confidence: row.confidence,
        last_disbursement_date: row.last_disbursement_date,
      },
    });

    addLink(links, {
      source: consultantNodeId,
      target: candidateNodeId,
      type: "consultant_candidate",
      label: "Consultant works with candidate",
      strength,
      amount,
      transaction_count: transactions,
      raw: {
        relationship_id: row.relationship_id,
        category: row.relationship_category,
        purpose: row.purpose,
        confidence: row.confidence,
        last_disbursement_date: row.last_disbursement_date,
      },
    });

    addLink(links, {
      source: committeeNodeId,
      target: candidateNodeId,
      type: "committee_candidate",
      label: "Committee linked to candidate",
      strength: Math.max(20, Math.round(strength * 0.85)),
      amount,
      transaction_count: transactions,
      raw: {
        relationship_id: row.relationship_id,
        category: row.relationship_category,
        confidence: row.confidence,
      },
    });
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => num(b.total_amount) - num(a.total_amount)),
    links: [...links.values()].sort((a, b) => num(b.amount) - num(a.amount)),
  };
}

function buildInsights(nodes, links) {
  const candidates = nodes.filter((node) => node.type === "candidate");
  const consultants = nodes.filter((node) => node.type === "consultant");
  const committees = nodes.filter((node) => node.type === "committee");

  const topInfluencers = [...nodes]
    .sort((a, b) => num(b.influence) - num(a.influence))
    .slice(0, 10);

  const strongestLinks = [...links]
    .sort((a, b) => num(b.strength) - num(a.strength))
    .slice(0, 10);

  const orphanCandidates = candidates.filter((candidateNode) => {
    return !links.some(
      (link) => link.source === candidateNode.id || link.target === candidateNode.id
    );
  });

  const totalAmount = links.reduce((sum, link) => sum + num(link.amount), 0);

  return {
    summary: [
      `${committees.length} committee nodes, ${consultants.length} consultant nodes, and ${candidates.length} candidate nodes are mapped from FEC-derived relationship data.`,
      `${strongestLinks.length} high-value relationship paths are ready for committee, consultant, and candidate intelligence review.`,
      `${moneyLabel(totalAmount)} in visible relationship money flow is represented in the current graph.`,
    ],
    top_influencers: topInfluencers,
    topInfluencers,
    strongest_links: strongestLinks,
    highStrengthLinks: strongestLinks,
    orphan_candidates: orphanCandidates.slice(0, 20),
    orphanCandidates: orphanCandidates.slice(0, 20),
  };
}

export async function getRelationshipGraph(options = {}) {
  const limit = Math.min(Math.max(num(options.limit, 100), 10), 1000);

  const filters = {
    cycle: num(options.cycle, getDefaultCycle()),
    state: clean(options.state),
    party: clean(options.party),
    office: clean(options.office),
    search: clean(options.search),
    committee: clean(options.committee),
    consultant: clean(options.consultant),
    candidate: clean(options.candidate),
    minAmount: clean(options.minAmount || options.min_amount),
    limit,
  };

  const rows = await fetchRelationshipRows(filters);
  const { nodes, links } = buildGraphFromRelationships(rows);
  const insights = buildInsights(nodes, links);

  return {
    filters,
    counts: {
      committees: nodes.filter((node) => node.type === "committee").length,
      candidates: nodes.filter((node) => node.type === "candidate").length,
      consultants: nodes.filter((node) => node.type === "consultant").length,
      donors: 0,
      nodes: nodes.length,
      links: links.length,
      rows: rows.length,
    },
    nodes,
    links,
    insights,
  };
}
