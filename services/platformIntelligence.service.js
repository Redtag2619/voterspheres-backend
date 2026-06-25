import { pool } from "../db/pool.js";

const ALL_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
];

function text(value = "") {
  return String(value ?? "").trim();
}

function num(value = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, num(value)));
}

function normalizeState(value = "") {
  const state = text(value).toUpperCase();
  return ALL_STATES.includes(state) ? state : state;
}

async function tableExists(tableName) {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists
    `,
    [tableName]
  );

  return Boolean(result.rows[0]?.exists);
}

async function getColumns(tableName) {
  if (!(await tableExists(tableName))) return [];

  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );

  return result.rows.map((row) => row.column_name);
}

function has(cols, name) {
  return cols.includes(name);
}

function candidateNameExpression(cols) {
  if (has(cols, "name")) return "name";
  if (has(cols, "candidate_name")) return "candidate_name";
  if (has(cols, "full_name")) return "full_name";
  if (has(cols, "first_name") && has(cols, "last_name")) {
    return "CONCAT_WS(' ', first_name, last_name)";
  }
  return "NULL";
}

function stateExpression(cols) {
  if (has(cols, "state")) return "state";
  if (has(cols, "state_code")) return "state_code";
  if (has(cols, "primary_state")) return "primary_state";
  if (has(cols, "payee_state")) return "payee_state";
  return "NULL";
}

function officeExpression(cols) {
  if (has(cols, "office")) return "office";
  if (has(cols, "race_type")) return "race_type";
  return "NULL";
}

function partyExpression(cols) {
  if (has(cols, "party")) return "party";
  if (has(cols, "candidate_party")) return "candidate_party";
  return "NULL";
}

function idExpression(cols) {
  if (has(cols, "id")) return "id";
  if (has(cols, "candidate_id")) return "candidate_id";
  if (has(cols, "vendor_id")) return "vendor_id";
  return "NULL";
}

function amountExpression(cols) {
  if (has(cols, "amount")) return "amount";
  if (has(cols, "total_amount")) return "total_amount";
  if (has(cols, "receipts")) return "receipts";
  if (has(cols, "total_receipts")) return "total_receipts";
  if (has(cols, "contract_value")) return "contract_value";
  if (has(cols, "fec_contract_value")) return "fec_contract_value";
  return "0";
}

function sourceExpression(cols) {
  if (has(cols, "source")) return "source";
  return "NULL";
}

function createdExpression(cols) {
  if (has(cols, "updated_at")) return "updated_at";
  if (has(cols, "created_at")) return "created_at";
  if (has(cols, "source_updated_at")) return "source_updated_at";
  return "NOW()";
}

function scoreTone(score) {
  const value = num(score);
  if (value >= 85) return "critical";
  if (value >= 70) return "elevated";
  if (value >= 50) return "watch";
  return "stable";
}

function addNode(map, node) {
  if (!node?.id) return;

  const existing = map.get(node.id);

  if (!existing) {
    map.set(node.id, {
      connections: 0,
      score: 0,
      value: 0,
      ...node,
    });
    return;
  }

  map.set(node.id, {
    ...existing,
    ...node,
    score: Math.max(num(existing.score), num(node.score)),
    value: Math.max(num(existing.value), num(node.value)),
  });
}

function addEdge(edges, nodeMap, edge) {
  if (!edge?.from || !edge?.to || edge.from === edge.to) return;

  edges.push({
    strength: 50,
    value: 0,
    ...edge,
  });

  const from = nodeMap.get(edge.from);
  const to = nodeMap.get(edge.to);

  if (from) {
    nodeMap.set(edge.from, {
      ...from,
      connections: num(from.connections) + 1,
    });
  }

  if (to) {
    nodeMap.set(edge.to, {
      ...to,
      connections: num(to.connections) + 1,
    });
  }
}

async function loadCandidates({ limit = 250, state = "", search = "" } = {}) {
  const cols = await getColumns("candidates");
  if (!cols.length) return [];

  const idSql = idExpression(cols);
  const nameSql = candidateNameExpression(cols);
  const stateSql = stateExpression(cols);
  const officeSql = officeExpression(cols);
  const partySql = partyExpression(cols);
  const amountSql = amountExpression(cols);
  const createdSql = createdExpression(cols);

  const where = [];
  const values = [];

  if (state) {
    values.push(state);
    where.push(`UPPER(COALESCE(${stateSql}, '')) = UPPER($${values.length})`);
  }

  if (search) {
    values.push(search);
    where.push(`
      (
        COALESCE(${nameSql}, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(${officeSql}, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(${partySql}, '') ILIKE '%' || $${values.length} || '%'
      )
    `);
  }

  values.push(Math.max(1, Math.min(Number(limit) || 250, 500)));

  const result = await pool.query(
    `
      SELECT
        ${idSql} AS id,
        ${nameSql} AS name,
        ${stateSql} AS state,
        ${officeSql} AS office,
        ${partySql} AS party,
        ${amountSql} AS value,
        ${createdSql} AS updated_at
      FROM candidates
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(${amountSql}, 0) DESC NULLS LAST
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows.map((row) => ({
    id: row.id ? String(row.id) : `candidate-${row.name}-${row.state}`,
    name: row.name || "Unnamed Candidate",
    state: normalizeState(row.state),
    office: row.office || "Candidate",
    party: row.party || "",
    value: num(row.value),
    updated_at: row.updated_at,
  }));
}

async function loadDonors({ limit = 250, state = "", search = "" } = {}) {
  const cols = await getColumns("donors");
  if (!cols.length) return [];

  const donorNameSql = has(cols, "donor_name")
    ? "COALESCE(donor_name, name)"
    : has(cols, "name")
    ? "name"
    : "NULL";

  const stateSql = stateExpression(cols);
  const amountSql = amountExpression(cols);
  const candidateSql = has(cols, "candidate_name") ? "candidate_name" : "NULL";
  const typeSql = has(cols, "donor_type") ? "donor_type" : "NULL";
  const strengthSql = has(cols, "relationship_strength") ? "relationship_strength" : "NULL";
  const createdSql = createdExpression(cols);

  const where = [];
  const values = [];

  if (state) {
    values.push(state);
    where.push(`UPPER(COALESCE(${stateSql}, '')) = UPPER($${values.length})`);
  }

  if (search) {
    values.push(search);
    where.push(`
      (
        COALESCE(${donorNameSql}, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(${candidateSql}, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(${typeSql}, '') ILIKE '%' || $${values.length} || '%'
      )
    `);
  }

  values.push(Math.max(1, Math.min(Number(limit) || 250, 500)));

  const result = await pool.query(
    `
      SELECT
        id,
        ${donorNameSql} AS name,
        ${stateSql} AS state,
        ${amountSql} AS value,
        ${candidateSql} AS candidate_name,
        ${typeSql} AS donor_type,
        ${strengthSql} AS relationship_strength,
        ${createdSql} AS updated_at
      FROM donors
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(${amountSql}, 0) DESC NULLS LAST
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows.map((row) => ({
    id: row.id ? String(row.id) : `donor-${row.name}-${row.state}`,
    name: row.name || "Unnamed Donor",
    state: normalizeState(row.state),
    value: num(row.value),
    candidate_name: row.candidate_name || "",
    donor_type: row.donor_type || "Donor",
    relationship_strength: row.relationship_strength || "",
    updated_at: row.updated_at,
  }));
}

async function loadVendors({ limit = 250, state = "", search = "" } = {}) {
  const cols = await getColumns("vendors");
  if (!cols.length) return [];

  const nameSql = has(cols, "vendor_name")
    ? "COALESCE(vendor_name, name)"
    : has(cols, "name")
    ? "name"
    : "NULL";

  const stateSql = stateExpression(cols);
  const amountSql = amountExpression(cols);
  const categorySql = has(cols, "category") ? "category" : has(cols, "services") ? "services" : "NULL";
  const sourceSql = sourceExpression(cols);
  const createdSql = createdExpression(cols);

  const where = [];
  const values = [];

  if (state) {
    values.push(state);
    where.push(`UPPER(COALESCE(${stateSql}, '')) = UPPER($${values.length})`);
  }

  if (search) {
    values.push(search);
    where.push(`
      (
        COALESCE(${nameSql}, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(${categorySql}, '') ILIKE '%' || $${values.length} || '%'
      )
    `);
  }

  values.push(Math.max(1, Math.min(Number(limit) || 250, 500)));

  const result = await pool.query(
    `
      SELECT
        id,
        ${nameSql} AS name,
        ${stateSql} AS state,
        ${amountSql} AS value,
        ${categorySql} AS category,
        ${sourceSql} AS source,
        ${createdSql} AS updated_at
      FROM vendors
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(${amountSql}, 0) DESC NULLS LAST
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows.map((row) => ({
    id: row.id ? String(row.id) : `vendor-${row.name}-${row.state}`,
    name: row.name || "Unnamed Vendor",
    state: normalizeState(row.state),
    value: num(row.value),
    category: row.category || "Campaign Vendor",
    source: row.source || "",
    updated_at: row.updated_at,
  }));
}

async function loadEndorsements({ limit = 250, state = "", search = "" } = {}) {
  const cols = await getColumns("endorsements");
  if (!cols.length) return [];

  const where = [];
  const values = [];

  if (state) {
    values.push(state);
    where.push(`UPPER(COALESCE(state, '')) = UPPER($${values.length})`);
  }

  if (search) {
    values.push(search);
    where.push(`
      (
        COALESCE(endorser_name, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(candidate_name, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(endorser_type, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(summary, '') ILIKE '%' || $${values.length} || '%'
      )
    `);
  }

  values.push(Math.max(1, Math.min(Number(limit) || 250, 500)));

  const result = await pool.query(
    `
      SELECT
        id,
        endorser_name,
        endorser_type,
        candidate_name,
        state,
        office,
        endorsement_score,
        influence_score,
        financial_signal_score,
        status,
        source,
        summary,
        updated_at
      FROM endorsements
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(endorsement_score, 0) DESC NULLS LAST
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows.map((row) => ({
    id: row.id ? String(row.id) : `endorsement-${row.endorser_name}-${row.state}`,
    name: row.endorser_name || "Unnamed Endorser",
    state: normalizeState(row.state),
    value: num(row.financial_signal_score),
    score: num(row.endorsement_score || row.influence_score),
    endorser_type: row.endorser_type || "Endorser",
    candidate_name: row.candidate_name || "",
    office: row.office || "",
    status: row.status || "",
    source: row.source || "",
    summary: row.summary || "",
    updated_at: row.updated_at,
  }));
}

async function loadTasks({ limit = 250, state = "", search = "" } = {}) {
  const cols = await getColumns("tasks");
  if (!cols.length) return [];

  const titleSql = has(cols, "title") ? "title" : "NULL";
  const descSql = has(cols, "description") ? "description" : has(cols, "detail") ? "detail" : "NULL";
  const stateSql = stateExpression(cols);
  const statusSql = has(cols, "status") ? "status" : "NULL";
  const prioritySql = has(cols, "priority") ? "priority" : "NULL";
  const sourceSql = sourceExpression(cols);
  const createdSql = createdExpression(cols);

  const where = [];
  const values = [];

  if (state) {
    values.push(state);
    where.push(`UPPER(COALESCE(${stateSql}, '')) = UPPER($${values.length})`);
  }

  if (search) {
    values.push(search);
    where.push(`
      (
        COALESCE(${titleSql}, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(${descSql}, '') ILIKE '%' || $${values.length} || '%'
      )
    `);
  }

  values.push(Math.max(1, Math.min(Number(limit) || 250, 500)));

  const result = await pool.query(
    `
      SELECT
        id,
        ${titleSql} AS title,
        ${descSql} AS description,
        ${stateSql} AS state,
        ${statusSql} AS status,
        ${prioritySql} AS priority,
        ${sourceSql} AS source,
        ${createdSql} AS updated_at
      FROM tasks
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${createdSql} DESC NULLS LAST
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows.map((row) => ({
    id: row.id ? String(row.id) : `task-${row.title}-${row.state}`,
    title: row.title || "Untitled Task",
    description: row.description || "",
    state: normalizeState(row.state),
    status: row.status || "",
    priority: row.priority || "",
    source: row.source || "",
    updated_at: row.updated_at,
  }));
}

function buildGraph({ candidates, donors, vendors, endorsements, tasks }) {
  const nodes = new Map();
  const edges = [];

  function addStateNode(state) {
    if (!state) return;

    addNode(nodes, {
      id: `state:${state}`,
      type: "state",
      label: state,
      state,
      subtitle: "Political geography",
      score: 60,
    });
  }

  for (const candidate of candidates) {
    const state = normalizeState(candidate.state);
    const id = `candidate:${candidate.id}`;

    addNode(nodes, {
      id,
      type: "candidate",
      label: candidate.name,
      state,
      subtitle: `${state || "National"} • ${candidate.office || "Candidate"} • ${candidate.party || ""}`,
      score: clamp(candidate.value / 10000, 45, 95),
      value: candidate.value,
      raw: candidate,
    });

    if (state) {
      addStateNode(state);
      addEdge(edges, nodes, {
        from: `state:${state}`,
        to: id,
        label: "candidate geography",
        strength: 70,
      });
    }
  }

  for (const donor of donors) {
    const state = normalizeState(donor.state);
    const id = `donor:${donor.id}`;

    addNode(nodes, {
      id,
      type: "donor",
      label: donor.name,
      state,
      subtitle: `${state || "National"} • ${donor.donor_type || "Donor"}`,
      score:
        donor.relationship_strength === "High"
          ? 88
          : donor.relationship_strength === "Medium"
          ? 72
          : clamp(donor.value / 10000, 45, 82),
      value: donor.value,
      raw: donor,
    });

    if (state) {
      addStateNode(state);
      addEdge(edges, nodes, {
        from: id,
        to: `state:${state}`,
        label: "donor geography",
        strength: 55,
        value: donor.value,
      });
    }

    if (donor.candidate_name) {
      const match = [...nodes.values()].find(
        (node) =>
          node.type === "candidate" &&
          text(node.label).toLowerCase() === text(donor.candidate_name).toLowerCase()
      );

      if (match) {
        addEdge(edges, nodes, {
          from: id,
          to: match.id,
          label: "donor to candidate",
          strength: 85,
          value: donor.value,
        });
      }
    }
  }

  for (const vendor of vendors) {
    const state = normalizeState(vendor.state);
    const id = `vendor:${vendor.id}`;

    addNode(nodes, {
      id,
      type: "vendor",
      label: vendor.name,
      state,
      subtitle: `${state || "National"} • ${vendor.category || "Campaign Vendor"}`,
      score: clamp(vendor.value / 10000, 45, 84),
      value: vendor.value,
      raw: vendor,
    });

    if (state) {
      addStateNode(state);
      addEdge(edges, nodes, {
        from: `state:${state}`,
        to: id,
        label: "vendor coverage",
        strength: 75,
        value: vendor.value,
      });
    }
  }

  for (const endorsement of endorsements) {
    const state = normalizeState(endorsement.state);
    const id = `endorsement:${endorsement.id}`;

    addNode(nodes, {
      id,
      type: "endorsement",
      label: endorsement.name,
      state,
      subtitle: `${state || "National"} • ${endorsement.endorser_type || "Endorser"} • ${endorsement.status || ""}`,
      score: endorsement.score || 50,
      value: endorsement.value,
      raw: endorsement,
    });

    if (state) {
      addStateNode(state);
      addEdge(edges, nodes, {
        from: id,
        to: `state:${state}`,
        label: "endorsement geography",
        strength: 70,
      });
    }

    if (endorsement.candidate_name) {
      const match = [...nodes.values()].find(
        (node) =>
          node.type === "candidate" &&
          text(node.label).toLowerCase() === text(endorsement.candidate_name).toLowerCase()
      );

      if (match) {
        addEdge(edges, nodes, {
          from: id,
          to: match.id,
          label: "endorses candidate",
          strength: 90,
        });
      }
    }
  }

  for (const task of tasks) {
    const state = normalizeState(task.state);
    const id = `task:${task.id}`;

    addNode(nodes, {
      id,
      type: "task",
      label: task.title,
      state,
      subtitle: `${state || "National"} • ${task.status || "Task"} • ${task.priority || ""}`,
      score:
        text(task.priority).toLowerCase() === "high"
          ? 86
          : text(task.priority).toLowerCase() === "medium"
          ? 70
          : 55,
      value: 0,
      raw: task,
    });

    if (state) {
      addStateNode(state);
      addEdge(edges, nodes, {
        from: id,
        to: `state:${state}`,
        label: "command center action",
        strength: 80,
      });
    }
  }

  return {
    nodes: [...nodes.values()].sort(
      (a, b) =>
        num(b.connections) - num(a.connections) ||
        num(b.score) - num(a.score)
    ),
    edges,
  };
}

function summarizeGraph(graph) {
  const byType = graph.nodes.reduce((acc, node) => {
    acc[node.type] = (acc[node.type] || 0) + 1;
    return acc;
  }, {});

  const byStateMap = new Map();

  for (const node of graph.nodes) {
    const state = normalizeState(node.state);
    if (!state) continue;

    if (!byStateMap.has(state)) {
      byStateMap.set(state, {
        state,
        nodes: 0,
        connections: 0,
        score_total: 0,
        value_total: 0,
      });
    }

    const current = byStateMap.get(state);
    current.nodes += 1;
    current.connections += num(node.connections);
    current.score_total += num(node.score);
    current.value_total += num(node.value);
  }

  const byState = [...byStateMap.values()]
    .map((item) => ({
      ...item,
      avg_score: Math.round(item.score_total / Math.max(1, item.nodes)),
      risk_label: scoreTone(item.score_total / Math.max(1, item.nodes)),
    }))
    .sort((a, b) => b.avg_score - a.avg_score || b.nodes - a.nodes);

  const topNodes = graph.nodes.slice(0, 20);

  return {
    total_nodes: graph.nodes.length,
    total_edges: graph.edges.length,
    by_type: byType,
    states_covered: byState.length,
    by_state: byState,
    top_nodes: topNodes,
  };
}

function buildActions({ graph, state = "" }) {
  const actions = [];

  const stateNodes = state
    ? graph.nodes.filter((node) => normalizeState(node.state) === normalizeState(state))
    : graph.nodes;

  const highValueNodes = stateNodes
    .filter((node) => num(node.score) >= 85)
    .slice(0, 10);

  for (const node of highValueNodes) {
    actions.push({
      title: `Review high-impact ${node.type}: ${node.label}`,
      detail: `${node.label} has a ${Math.round(num(node.score))}/100 intelligence score and ${node.connections || 0} relationship links.`,
      state: node.state || "National",
      priority: "High",
      owner: "Political Intelligence",
      source: "platform_intelligence",
      entity_type: node.type,
      entity_id: node.id,
    });
  }

  const disconnected = stateNodes
    .filter((node) => node.type !== "state" && num(node.connections) <= 1)
    .slice(0, 10);

  for (const node of disconnected) {
    actions.push({
      title: `Expand relationship context for ${node.label}`,
      detail: `${node.label} has limited cross-platform relationship context. Connect to candidates, donors, vendors, endorsements, or Command Center tasks.`,
      state: node.state || "National",
      priority: "Medium",
      owner: "Operations",
      source: "platform_intelligence",
      entity_type: node.type,
      entity_id: node.id,
    });
  }

  return actions.slice(0, 20);
}

export async function getPlatformIntelligence(params = {}) {
  const limit = Math.max(1, Math.min(Number(params.limit || 250), 500));
  const state = normalizeState(params.state || "");
  const search = text(params.search || params.q || "");

  const [candidates, donors, vendors, endorsements, tasks] = await Promise.all([
    loadCandidates({ limit, state, search }),
    loadDonors({ limit, state, search }),
    loadVendors({ limit, state, search }),
    loadEndorsements({ limit, state, search }),
    loadTasks({ limit, state, search }),
  ]);

  const graph = buildGraph({
    candidates,
    donors,
    vendors,
    endorsements,
    tasks,
  });

  const summary = summarizeGraph(graph);
  const actions = buildActions({ graph, state });

  return {
    ok: true,
    summary,
    graph,
    actions,
    sources: {
      candidates: candidates.length,
      donors: donors.length,
      vendors: vendors.length,
      endorsements: endorsements.length,
      tasks: tasks.length,
    },
  };
}

export async function getPlatformIntelligenceEntity(params = {}) {
  const entityType = text(params.entityType || params.type).toLowerCase();
  const entityName = text(params.entityName || params.name);
  const entityId = text(params.entityId || params.id);
  const state = normalizeState(params.state || "");
  const search = entityName || text(params.search || params.q || "");

  const data = await getPlatformIntelligence({
    limit: params.limit || 250,
    state,
    search,
  });

  let selected = null;

  if (entityId) {
    selected = data.graph.nodes.find(
      (node) =>
        node.id === entityId ||
        node.id.endsWith(`:${entityId}`) ||
        String(node.raw?.id || "") === entityId
    );
  }

  if (!selected && entityName) {
    selected = data.graph.nodes.find(
      (node) =>
        (!entityType || node.type === entityType) &&
        text(node.label).toLowerCase() === entityName.toLowerCase()
    );
  }

  if (!selected && entityName) {
    selected = data.graph.nodes.find(
      (node) =>
        (!entityType || node.type === entityType) &&
        text(node.label).toLowerCase().includes(entityName.toLowerCase())
    );
  }

  const relatedEdges = selected
    ? data.graph.edges.filter(
        (edge) => edge.from === selected.id || edge.to === selected.id
      )
    : [];

  const relatedIds = new Set();

  for (const edge of relatedEdges) {
    relatedIds.add(edge.from);
    relatedIds.add(edge.to);
  }

  if (selected) relatedIds.delete(selected.id);

  const relatedNodes = data.graph.nodes.filter((node) => relatedIds.has(node.id));

  return {
    ok: true,
    entity: selected || null,
    related_nodes: relatedNodes,
    related_edges: relatedEdges,
    actions: selected
      ? buildActions({
          graph: {
            nodes: [selected, ...relatedNodes],
            edges: relatedEdges,
          },
          state: selected.state,
        })
      : [],
    summary: {
      related_count: relatedNodes.length,
      relationship_count: relatedEdges.length,
      entity_found: Boolean(selected),
    },
  };
}

export async function getPlatformIntelligenceActions(params = {}) {
  const data = await getPlatformIntelligence(params);

  return {
    ok: true,
    actions: data.actions,
    summary: {
      total_actions: data.actions.length,
      high_priority: data.actions.filter((item) => item.priority === "High").length,
      medium_priority: data.actions.filter((item) => item.priority === "Medium").length,
    },
  };
}
