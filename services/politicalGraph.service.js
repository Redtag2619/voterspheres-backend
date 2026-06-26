import { pool } from "../db/pool.js";

const ALL_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

function text(value = "") {
  return String(value ?? "").trim();
}

function num(value = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, num(value)));
}

function state(value = "") {
  const s = text(value).toUpperCase();
  return ALL_STATES.includes(s) ? s : s;
}

async function tableExists(name) {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      ) AS exists
    `,
    [name]
  );

  return Boolean(result.rows[0]?.exists);
}

async function columns(name) {
  if (!(await tableExists(name))) return [];

  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [name]
  );

  return result.rows.map((row) => row.column_name);
}

function has(cols, col) {
  return cols.includes(col);
}

function pick(cols, choices, fallback = "NULL") {
  return choices.find((col) => has(cols, col)) || fallback;
}

function nameExpr(cols, tableType) {
  if (tableType === "candidate") {
    if (has(cols, "name")) return "name";
    if (has(cols, "candidate_name")) return "candidate_name";
    if (has(cols, "full_name")) return "full_name";
    if (has(cols, "first_name") && has(cols, "last_name")) {
      return "CONCAT_WS(' ', first_name, last_name)";
    }
  }

  if (tableType === "donor") {
    if (has(cols, "donor_name") && has(cols, "name")) return "COALESCE(donor_name, name)";
    if (has(cols, "donor_name")) return "donor_name";
    if (has(cols, "name")) return "name";
  }

  if (tableType === "vendor") {
    if (has(cols, "vendor_name") && has(cols, "name")) return "COALESCE(vendor_name, name)";
    if (has(cols, "vendor_name")) return "vendor_name";
    if (has(cols, "name")) return "name";
  }

  if (tableType === "endorsement") {
    if (has(cols, "endorser_name")) return "endorser_name";
  }

  if (tableType === "task") {
    if (has(cols, "title")) return "title";
  }

  return "NULL";
}

function stateExpr(cols) {
  return pick(cols, ["state", "state_code", "primary_state", "payee_state"], "NULL");
}

function idExpr(cols) {
  return pick(cols, ["id", "candidate_id", "vendor_id"], "NULL");
}

function officeExpr(cols) {
  return pick(cols, ["office", "race_type"], "NULL");
}

function partyExpr(cols) {
  return pick(cols, ["party", "candidate_party"], "NULL");
}

function amountExpr(cols) {
  return pick(
    cols,
    ["amount", "total_amount", "receipts", "total_receipts", "cash_on_hand", "contract_value", "fec_contract_value"],
    "0"
  );
}

function updatedExpr(cols) {
  return pick(cols, ["updated_at", "source_updated_at", "created_at"], "NOW()");
}

function nodeId(type, id, label, st) {
  return `${type}:${id || `${label}-${st}`}`.replace(/\s+/g, "-").toLowerCase();
}

function addNode(map, node) {
  if (!node?.id) return;

  const existing = map.get(node.id);

  if (!existing) {
    map.set(node.id, {
      connections: 0,
      score: 50,
      value: 0,
      ...node,
    });
    return;
  }

  map.set(node.id, {
    ...existing,
    ...node,
    connections: existing.connections || 0,
    score: Math.max(num(existing.score), num(node.score)),
    value: Math.max(num(existing.value), num(node.value)),
  });
}

function addEdge(edges, nodes, edge) {
  if (!edge?.from || !edge?.to || edge.from === edge.to) return;

  const key = `${edge.from}|${edge.to}|${edge.type || edge.label || "related"}`;
  if (edges.some((item) => item.key === key)) return;

  edges.push({
    key,
    strength: 50,
    value: 0,
    ...edge,
  });

  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);

  if (from) nodes.set(edge.from, { ...from, connections: num(from.connections) + 1 });
  if (to) nodes.set(edge.to, { ...to, connections: num(to.connections) + 1 });
}

async function loadCandidates({ limit, st, q }) {
  const cols = await columns("candidates");
  if (!cols.length) return [];

  const id = idExpr(cols);
  const name = nameExpr(cols, "candidate");
  const stateSql = stateExpr(cols);
  const office = officeExpr(cols);
  const party = partyExpr(cols);
  const amount = amountExpr(cols);
  const updated = updatedExpr(cols);

  const where = [];
  const values = [];

  if (st) {
    values.push(st);
    where.push(`UPPER(COALESCE(${stateSql},'')) = UPPER($${values.length})`);
  }

  if (q) {
    values.push(q);
    where.push(`
      (
        COALESCE(${name}, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(${office}, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(${party}, '') ILIKE '%' || $${values.length} || '%'
      )
    `);
  }

  values.push(limit);

  const result = await pool.query(
    `
      SELECT
        ${id} AS id,
        ${name} AS name,
        ${stateSql} AS state,
        ${office} AS office,
        ${party} AS party,
        ${amount} AS value,
        ${updated} AS updated_at
      FROM candidates
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(${amount}, 0) DESC NULLS LAST
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows.map((row) => ({
    type: "candidate",
    id: nodeId("candidate", row.id, row.name, row.state),
    source_id: row.id,
    label: row.name || "Unnamed Candidate",
    state: state(row.state),
    office: row.office || "Candidate",
    party: row.party || "",
    value: num(row.value),
    score: clamp(num(row.value) / 10000, 45, 95),
    updated_at: row.updated_at,
    raw: row,
  }));
}

async function loadDonors({ limit, st, q }) {
  const cols = await columns("donors");
  if (!cols.length) return [];

  const id = idExpr(cols);
  const name = nameExpr(cols, "donor");
  const stateSql = stateExpr(cols);
  const amount = amountExpr(cols);
  const updated = updatedExpr(cols);
  const candidateName = pick(cols, ["candidate_name"], "NULL");
  const donorType = pick(cols, ["donor_type"], "NULL");
  const strength = pick(cols, ["relationship_strength"], "NULL");

  const where = [];
  const values = [];

  if (st) {
    values.push(st);
    where.push(`UPPER(COALESCE(${stateSql},'')) = UPPER($${values.length})`);
  }

  if (q) {
    values.push(q);
    where.push(`
      (
        COALESCE(${name}, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(${candidateName}, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(${donorType}, '') ILIKE '%' || $${values.length} || '%'
      )
    `);
  }

  values.push(limit);

  const result = await pool.query(
    `
      SELECT
        ${id} AS id,
        ${name} AS name,
        ${stateSql} AS state,
        ${amount} AS value,
        ${candidateName} AS candidate_name,
        ${donorType} AS donor_type,
        ${strength} AS relationship_strength,
        ${updated} AS updated_at
      FROM donors
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(${amount}, 0) DESC NULLS LAST
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows.map((row) => ({
    type: "donor",
    id: nodeId("donor", row.id, row.name, row.state),
    source_id: row.id,
    label: row.name || "Unnamed Donor",
    state: state(row.state),
    value: num(row.value),
    score:
      row.relationship_strength === "High"
        ? 88
        : row.relationship_strength === "Medium"
        ? 72
        : clamp(num(row.value) / 10000, 45, 86),
    candidate_name: row.candidate_name || "",
    donor_type: row.donor_type || "Donor",
    relationship_strength: row.relationship_strength || "",
    updated_at: row.updated_at,
    raw: row,
  }));
}

async function loadVendors({ limit, st, q }) {
  const cols = await columns("vendors");
  if (!cols.length) return [];

  const id = idExpr(cols);
  const name = nameExpr(cols, "vendor");
  const stateSql = stateExpr(cols);
  const amount = amountExpr(cols);
  const updated = updatedExpr(cols);
  const category = pick(cols, ["category", "services"], "NULL");
  const source = pick(cols, ["source"], "NULL");

  const where = [];
  const values = [];

  if (st) {
    values.push(st);
    where.push(`UPPER(COALESCE(${stateSql},'')) = UPPER($${values.length})`);
  }

  if (q) {
    values.push(q);
    where.push(`
      (
        COALESCE(${name}, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(${category}, '') ILIKE '%' || $${values.length} || '%'
      )
    `);
  }

  values.push(limit);

  const result = await pool.query(
    `
      SELECT
        ${id} AS id,
        ${name} AS name,
        ${stateSql} AS state,
        ${amount} AS value,
        ${category} AS category,
        ${source} AS source,
        ${updated} AS updated_at
      FROM vendors
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(${amount}, 0) DESC NULLS LAST
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows.map((row) => ({
    type: "vendor",
    id: nodeId("vendor", row.id, row.name, row.state),
    source_id: row.id,
    label: row.name || "Unnamed Vendor",
    state: state(row.state),
    value: num(row.value),
    score: clamp(num(row.value) / 10000, 45, 86),
    category: row.category || "Campaign Vendor",
    source: row.source || "",
    updated_at: row.updated_at,
    raw: row,
  }));
}

async function loadEndorsements({ limit, st, q }) {
  const exists = await tableExists("endorsements");
  if (!exists) return [];

  const where = [];
  const values = [];

  if (st) {
    values.push(st);
    where.push(`UPPER(COALESCE(state,'')) = UPPER($${values.length})`);
  }

  if (q) {
    values.push(q);
    where.push(`
      (
        COALESCE(endorser_name, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(candidate_name, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(endorser_type, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(summary, '') ILIKE '%' || $${values.length} || '%'
      )
    `);
  }

  values.push(limit);

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
    type: "endorsement",
    id: nodeId("endorsement", row.id, row.endorser_name, row.state),
    source_id: row.id,
    label: row.endorser_name || "Unnamed Endorser",
    state: state(row.state),
    office: row.office || "",
    value: num(row.financial_signal_score),
    score: num(row.endorsement_score || row.influence_score || 50),
    endorser_type: row.endorser_type || "Endorser",
    candidate_name: row.candidate_name || "",
    status: row.status || "",
    source: row.source || "",
    summary: row.summary || "",
    updated_at: row.updated_at,
    raw: row,
  }));
}

async function loadTasks({ limit, st, q }) {
  const cols = await columns("tasks");
  if (!cols.length) return [];

  const id = idExpr(cols);
  const title = pick(cols, ["title"], "NULL");
  const description = pick(cols, ["description", "detail"], "NULL");
  const stateSql = stateExpr(cols);
  const status = pick(cols, ["status"], "NULL");
  const priority = pick(cols, ["priority"], "NULL");
  const source = pick(cols, ["source"], "NULL");
  const updated = updatedExpr(cols);

  const where = [];
  const values = [];

  if (st) {
    values.push(st);
    where.push(`UPPER(COALESCE(${stateSql},'')) = UPPER($${values.length})`);
  }

  if (q) {
    values.push(q);
    where.push(`
      (
        COALESCE(${title}, '') ILIKE '%' || $${values.length} || '%'
        OR COALESCE(${description}, '') ILIKE '%' || $${values.length} || '%'
      )
    `);
  }

  values.push(limit);

  const result = await pool.query(
    `
      SELECT
        ${id} AS id,
        ${title} AS title,
        ${description} AS description,
        ${stateSql} AS state,
        ${status} AS status,
        ${priority} AS priority,
        ${source} AS source,
        ${updated} AS updated_at
      FROM tasks
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${updated} DESC NULLS LAST
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows.map((row) => ({
    type: "task",
    id: nodeId("task", row.id, row.title, row.state),
    source_id: row.id,
    label: row.title || "Command Center Task",
    state: state(row.state),
    value: 0,
    score:
      text(row.priority).toLowerCase() === "high"
        ? 88
        : text(row.priority).toLowerCase() === "medium"
        ? 72
        : 55,
    status: row.status || "",
    priority: row.priority || "",
    source: row.source || "",
    description: row.description || "",
    updated_at: row.updated_at,
    raw: row,
  }));
}

function buildGraph({ candidates, donors, vendors, endorsements, tasks }) {
  const nodes = new Map();
  const edges = [];

  function addState(st) {
    if (!st) return;

    addNode(nodes, {
      id: `state:${st}`,
      type: "state",
      label: st,
      state: st,
      score: 60,
      value: 0,
      subtitle: "Political geography",
    });
  }

  for (const item of candidates) {
    addNode(nodes, item);
    if (item.state) {
      addState(item.state);
      addEdge(edges, nodes, {
        from: `state:${item.state}`,
        to: item.id,
        type: "located_in",
        label: "candidate geography",
        strength: 70,
      });
    }
  }

  for (const item of donors) {
    addNode(nodes, item);
    if (item.state) {
      addState(item.state);
      addEdge(edges, nodes, {
        from: item.id,
        to: `state:${item.state}`,
        type: "donor_geography",
        label: "donor geography",
        strength: 55,
        value: item.value,
      });
    }

    if (item.candidate_name) {
      const match = [...nodes.values()].find(
        (node) =>
          node.type === "candidate" &&
          text(node.label).toLowerCase() === text(item.candidate_name).toLowerCase()
      );

      if (match) {
        addEdge(edges, nodes, {
          from: item.id,
          to: match.id,
          type: "donated_to",
          label: "donor to candidate",
          strength: 85,
          value: item.value,
        });
      }
    }
  }

  for (const item of vendors) {
    addNode(nodes, item);
    if (item.state) {
      addState(item.state);
      addEdge(edges, nodes, {
        from: `state:${item.state}`,
        to: item.id,
        type: "vendor_coverage",
        label: "vendor coverage",
        strength: 75,
        value: item.value,
      });
    }
  }

  for (const item of endorsements) {
    addNode(nodes, item);
    if (item.state) {
      addState(item.state);
      addEdge(edges, nodes, {
        from: item.id,
        to: `state:${item.state}`,
        type: "endorsement_geography",
        label: "endorsement geography",
        strength: 70,
      });
    }

    if (item.candidate_name) {
      const match = [...nodes.values()].find(
        (node) =>
          node.type === "candidate" &&
          text(node.label).toLowerCase() === text(item.candidate_name).toLowerCase()
      );

      if (match) {
        addEdge(edges, nodes, {
          from: item.id,
          to: match.id,
          type: "endorses",
          label: "endorses candidate",
          strength: 90,
        });
      }
    }
  }

  for (const item of tasks) {
    addNode(nodes, item);
    if (item.state) {
      addState(item.state);
      addEdge(edges, nodes, {
        from: item.id,
        to: `state:${item.state}`,
        type: "command_action",
        label: "command center action",
        strength: 80,
      });
    }
  }

  const finalNodes = [...nodes.values()].sort(
    (a, b) =>
      num(b.connections) - num(a.connections) ||
      num(b.score) - num(a.score)
  );

  return { nodes: finalNodes, edges };
}

function summarize(graph) {
  const byType = {};
  const byState = new Map();

  for (const node of graph.nodes) {
    byType[node.type] = (byType[node.type] || 0) + 1;

    if (node.state) {
      if (!byState.has(node.state)) {
        byState.set(node.state, {
          state: node.state,
          nodes: 0,
          connections: 0,
          score_total: 0,
          value_total: 0,
        });
      }

      const current = byState.get(node.state);
      current.nodes += 1;
      current.connections += num(node.connections);
      current.score_total += num(node.score);
      current.value_total += num(node.value);
    }
  }

  const states = [...byState.values()]
    .map((row) => ({
      ...row,
      avg_score: Math.round(row.score_total / Math.max(1, row.nodes)),
    }))
    .sort((a, b) => b.avg_score - a.avg_score || b.nodes - a.nodes);

  return {
    total_nodes: graph.nodes.length,
    total_edges: graph.edges.length,
    by_type: byType,
    states_covered: states.length,
    by_state: states,
    top_nodes: graph.nodes.slice(0, 25),
  };
}

function actions(graph, st = "") {
  const scoped = st
    ? graph.nodes.filter((node) => state(node.state) === state(st))
    : graph.nodes;

  const high = scoped.filter((node) => num(node.score) >= 85).slice(0, 12);
  const lowContext = scoped
    .filter((node) => node.type !== "state" && num(node.connections) <= 1)
    .slice(0, 12);

  return [
    ...high.map((node) => ({
      title: `Review high-impact ${node.type}: ${node.label}`,
      detail: `${node.label} has an intelligence score of ${Math.round(num(node.score))}/100 and ${node.connections || 0} graph links.`,
      state: node.state || "National",
      priority: "High",
      owner: "Political Intelligence",
      source: "political_relationship_graph",
      entity_type: node.type,
      entity_id: node.id,
    })),
    ...lowContext.map((node) => ({
      title: `Expand relationship context for ${node.label}`,
      detail: `${node.label} has limited relationship context. Connect it to candidates, donors, vendors, endorsements, tasks, or geography.`,
      state: node.state || "National",
      priority: "Medium",
      owner: "Operations",
      source: "political_relationship_graph",
      entity_type: node.type,
      entity_id: node.id,
    })),
  ].slice(0, 25);
}

export async function getPoliticalGraph(params = {}) {
  const limit = Math.max(1, Math.min(Number(params.limit || 250), 500));
  const st = state(params.state || "");
  const q = text(params.search || params.q || "");

  const [candidates, donors, vendors, endorsements, tasks] = await Promise.all([
    loadCandidates({ limit, st, q }),
    loadDonors({ limit, st, q }),
    loadVendors({ limit, st, q }),
    loadEndorsements({ limit, st, q }),
    loadTasks({ limit, st, q }),
  ]);

  const graph = buildGraph({ candidates, donors, vendors, endorsements, tasks });

  return {
    ok: true,
    summary: summarize(graph),
    graph,
    actions: actions(graph, st),
    sources: {
      candidates: candidates.length,
      donors: donors.length,
      vendors: vendors.length,
      endorsements: endorsements.length,
      tasks: tasks.length,
    },
  };
}

export async function searchPoliticalGraph(params = {}) {
  return getPoliticalGraph({
    ...params,
    search: params.search || params.q || "",
  });
}

export async function getPoliticalGraphEntity(params = {}) {
  const entityId = text(params.entity_id || params.entityId || params.id);
  const entityType = text(params.entity_type || params.entityType || params.type).toLowerCase();
  const entityName = text(params.entity_name || params.entityName || params.name);
  const data = await getPoliticalGraph(params);

  let entity = null;

  if (entityId) {
    entity = data.graph.nodes.find(
      (node) =>
        node.id === entityId ||
        String(node.source_id || "") === entityId ||
        node.id.endsWith(`:${entityId}`)
    );
  }

  if (!entity && entityName) {
    entity = data.graph.nodes.find(
      (node) =>
        (!entityType || node.type === entityType) &&
        text(node.label).toLowerCase() === entityName.toLowerCase()
    );
  }

  if (!entity && entityName) {
    entity = data.graph.nodes.find(
      (node) =>
        (!entityType || node.type === entityType) &&
        text(node.label).toLowerCase().includes(entityName.toLowerCase())
    );
  }

  const relatedEdges = entity
    ? data.graph.edges.filter((edge) => edge.from === entity.id || edge.to === entity.id)
    : [];

  const ids = new Set();

  for (const edge of relatedEdges) {
    ids.add(edge.from);
    ids.add(edge.to);
  }

  if (entity) ids.delete(entity.id);

  const relatedNodes = data.graph.nodes.filter((node) => ids.has(node.id));

  return {
    ok: true,
    entity,
    related_nodes: relatedNodes,
    related_edges: relatedEdges,
    actions: entity ? actions({ nodes: [entity, ...relatedNodes], edges: relatedEdges }, entity.state) : [],
    summary: {
      entity_found: Boolean(entity),
      related_count: relatedNodes.length,
      relationship_count: relatedEdges.length,
    },
  };
}

export async function getPoliticalGraphPath(params = {}) {
  const from = text(params.from);
  const to = text(params.to);
  const data = await getPoliticalGraph(params);

  if (!from || !to) {
    return {
      ok: false,
      error: "Both from and to are required.",
      path: [],
    };
  }

  const adjacency = new Map();

  for (const edge of data.graph.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
  }

  const queue = [[from]];
  const seen = new Set([from]);

  while (queue.length) {
    const path = queue.shift();
    const last = path[path.length - 1];

    if (last === to) {
      return {
        ok: true,
        path,
        nodes: path.map((id) => data.graph.nodes.find((node) => node.id === id)).filter(Boolean),
      };
    }

    for (const next of adjacency.get(last) || []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...path, next]);
      }
    }
  }

  return {
    ok: true,
    path: [],
    nodes: [],
  };
}
