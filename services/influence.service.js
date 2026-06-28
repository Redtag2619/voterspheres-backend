import { pool } from "../db/pool.js";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","IA","ID","IL","IN","KS","KY","LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY"
];

const ENTITY_WEIGHTS = {
  candidate: 1.35,
  donor: 1.25,
  vendor: 1.05,
  endorsement: 1.2,
  consultant: 1.15,
  pac: 1.3,
  committee: 1.25,
  organization: 1.1,
  state: 0.85,
  task: 0.7,
};

function n(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clean(value = "") {
  return String(value || "").trim();
}

function keyFor(type, name, state = "") {
  return `${clean(type).toLowerCase()}::${clean(state).toUpperCase()}::${clean(name).toLowerCase()}`;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n(value)));
}

async function tableExists(client, table) {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      ) AS exists
    `,
    [table]
  );

  return Boolean(result.rows?.[0]?.exists);
}

async function getColumns(client, table) {
  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [table]
  );

  return new Set(result.rows.map((row) => row.column_name));
}

function firstCol(columns, options = []) {
  return options.find((item) => columns.has(item)) || null;
}

async function ensureInfluenceSchema(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS influence_entities (
      id SERIAL PRIMARY KEY,
      entity_key TEXT UNIQUE NOT NULL,
      entity_type TEXT NOT NULL,
      entity_name TEXT NOT NULL,
      state TEXT,
      office TEXT,
      party TEXT,
      category TEXT,
      influence_score NUMERIC DEFAULT 0,
      centrality_score NUMERIC DEFAULT 0,
      reach_score NUMERIC DEFAULT 0,
      momentum_score NUMERIC DEFAULT 0,
      risk_score NUMERIC DEFAULT 0,
      total_connections INTEGER DEFAULT 0,
      direct_connections INTEGER DEFAULT 0,
      second_degree_connections INTEGER DEFAULT 0,
      weighted_connection_score NUMERIC DEFAULT 0,
      source_count INTEGER DEFAULT 0,
      source_tables JSONB DEFAULT '[]'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      calculated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS influence_edges (
      id SERIAL PRIMARY KEY,
      source_key TEXT NOT NULL,
      target_key TEXT NOT NULL,
      source_type TEXT,
      target_type TEXT,
      relationship_type TEXT NOT NULL,
      state TEXT,
      weight NUMERIC DEFAULT 1,
      strength NUMERIC DEFAULT 50,
      value NUMERIC DEFAULT 0,
      source_table TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(source_key, target_key, relationship_type, source_table)
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS influence_alerts (
      id SERIAL PRIMARY KEY,
      alert_key TEXT UNIQUE NOT NULL,
      entity_key TEXT,
      entity_type TEXT,
      entity_name TEXT,
      state TEXT,
      severity TEXT DEFAULT 'medium',
      title TEXT NOT NULL,
      detail TEXT,
      influence_score NUMERIC DEFAULT 0,
      change_score NUMERIC DEFAULT 0,
      metadata JSONB DEFAULT '{}'::jsonb,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS influence_snapshots (
      id SERIAL PRIMARY KEY,
      snapshot_key TEXT UNIQUE NOT NULL,
      summary JSONB DEFAULT '{}'::jsonb,
      rankings JSONB DEFAULT '[]'::jsonb,
      state_rankings JSONB DEFAULT '{}'::jsonb,
      alerts JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_influence_entities_type ON influence_entities(entity_type);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_influence_entities_state ON influence_entities(state);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_influence_entities_score ON influence_entities(influence_score DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_influence_edges_source ON influence_edges(source_key);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_influence_edges_target ON influence_edges(target_key);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_influence_alerts_state ON influence_alerts(state);`);
}

function addEntity(map, payload = {}) {
  const type = clean(payload.entity_type || payload.type || "organization").toLowerCase();
  const name = clean(payload.entity_name || payload.name || payload.label);
  if (!name) return null;

  const state = clean(payload.state || "").toUpperCase();
  const entityKey = payload.entity_key || keyFor(type, name, state);

  const existing = map.get(entityKey) || {
    entity_key: entityKey,
    entity_type: type,
    entity_name: name,
    state,
    office: payload.office || null,
    party: payload.party || null,
    category: payload.category || null,
    source_tables: new Set(),
    source_count: 0,
    metadata: {},
  };

  existing.entity_name = existing.entity_name || name;
  existing.state = existing.state || state;
  existing.office = existing.office || payload.office || null;
  existing.party = existing.party || payload.party || null;
  existing.category = existing.category || payload.category || null;

  if (payload.source_table) existing.source_tables.add(payload.source_table);
  existing.source_count = existing.source_tables.size;
  existing.metadata = {
    ...(existing.metadata || {}),
    ...(payload.metadata || {}),
  };

  map.set(entityKey, existing);
  return existing;
}

function addEdge(edges, source, target, payload = {}) {
  if (!source?.entity_key || !target?.entity_key) return;

  const sourceKey = source.entity_key;
  const targetKey = target.entity_key;
  if (sourceKey === targetKey) return;

  const relationshipType = clean(payload.relationship_type || "related_to").toLowerCase();
  const sourceTable = clean(payload.source_table || "modeled");
  const edgeKey = `${sourceKey}::${targetKey}::${relationshipType}::${sourceTable}`;

  const existing = edges.get(edgeKey) || {
    source_key: sourceKey,
    target_key: targetKey,
    source_type: source.entity_type,
    target_type: target.entity_type,
    relationship_type: relationshipType,
    state: source.state || target.state || payload.state || null,
    weight: 0,
    strength: 0,
    value: 0,
    source_table: sourceTable,
    metadata: {},
  };

  existing.weight += n(payload.weight, 1);
  existing.strength = Math.max(existing.strength, n(payload.strength, 50));
  existing.value += n(payload.value, 0);
  existing.metadata = {
    ...(existing.metadata || {}),
    ...(payload.metadata || {}),
  };

  edges.set(edgeKey, existing);
}

async function collectCandidates(client, entities, edges) {
  if (!(await tableExists(client, "candidates"))) return;

  const columns = await getColumns(client, "candidates");
  const nameCol = firstCol(columns, ["name", "candidate_name", "full_name", "display_name"]);
  const stateCol = firstCol(columns, ["state", "state_code"]);
  const officeCol = firstCol(columns, ["office", "race", "seat"]);
  const partyCol = firstCol(columns, ["party", "party_full"]);

  if (!nameCol) return;

  const result = await client.query(`
    SELECT *
    FROM candidates
    ORDER BY id DESC
    LIMIT 1500
  `);

  for (const row of result.rows) {
    const candidate = addEntity(entities, {
      entity_type: "candidate",
      entity_name: row[nameCol],
      state: stateCol ? row[stateCol] : "",
      office: officeCol ? row[officeCol] : null,
      party: partyCol ? row[partyCol] : null,
      source_table: "candidates",
      metadata: { candidate_id: row.id },
    });

    if (candidate?.state) {
      const stateNode = addEntity(entities, {
        entity_type: "state",
        entity_name: candidate.state,
        state: candidate.state,
        source_table: "modeled_states",
      });

      addEdge(edges, candidate, stateNode, {
        relationship_type: "runs_in",
        weight: 2.4,
        strength: 70,
        source_table: "candidates",
      });
    }
  }
}

async function collectEndorsements(client, entities, edges) {
  if (!(await tableExists(client, "endorsements"))) return;

  const result = await client.query(`
    SELECT *
    FROM endorsements
    ORDER BY id DESC
    LIMIT 2500
  `);

  for (const row of result.rows) {
    const state = clean(row.state || row.state_code || "").toUpperCase();

    const endorserName =
      row.endorser_name ||
      row.organization_name ||
      row.name ||
      row.source_name ||
      row.title;

    const candidateName =
      row.candidate_name ||
      row.candidate ||
      row.recipient_name ||
      row.target_name;

    const endorser = addEntity(entities, {
      entity_type: row.endorser_type || "endorsement",
      entity_name: endorserName,
      state,
      category: row.category || row.endorsement_type || "endorsement",
      source_table: "endorsements",
      metadata: { endorsement_id: row.id },
    });

    const candidate = candidateName
      ? addEntity(entities, {
          entity_type: "candidate",
          entity_name: candidateName,
          state,
          office: row.office,
          party: row.party,
          source_table: "endorsements",
          metadata: { candidate_id: row.candidate_id },
        })
      : null;

    if (endorser && candidate) {
      addEdge(edges, endorser, candidate, {
        relationship_type: "endorses",
        weight: 3.2,
        strength: n(row.influence_score || row.endorsement_score || row.score, 72),
        source_table: "endorsements",
        metadata: { endorsement_id: row.id },
      });
    }

    if (endorser && state) {
      const stateNode = addEntity(entities, {
        entity_type: "state",
        entity_name: state,
        state,
        source_table: "modeled_states",
      });

      addEdge(edges, endorser, stateNode, {
        relationship_type: "influences_state",
        weight: 1.5,
        strength: 58,
        source_table: "endorsements",
      });
    }
  }
}

async function collectVendors(client, entities, edges) {
  const table = (await tableExists(client, "vendors")) ? "vendors" : null;
  if (!table) return;

  const result = await client.query(`
    SELECT *
    FROM vendors
    ORDER BY id DESC
    LIMIT 2000
  `);

  for (const row of result.rows) {
    const state = clean(row.state || row.primary_state || row.payee_state || "").toUpperCase();
    const name = row.vendor_name || row.name || row.payee_name || row.company_name;

    const vendor = addEntity(entities, {
      entity_type: "vendor",
      entity_name: name,
      state,
      category: row.category || row.service_category || row.type,
      source_table: "vendors",
      metadata: { vendor_id: row.id },
    });

    if (vendor && state) {
      const stateNode = addEntity(entities, {
        entity_type: "state",
        entity_name: state,
        state,
        source_table: "modeled_states",
      });

      addEdge(edges, vendor, stateNode, {
        relationship_type: "operates_in",
        weight: 1.8,
        strength: n(row.coverage_score || row.score, 54),
        source_table: "vendors",
      });
    }
  }
}

async function collectTasks(client, entities, edges) {
  if (!(await tableExists(client, "tasks"))) return;

  const result = await client.query(`
    SELECT *
    FROM tasks
    ORDER BY id DESC
    LIMIT 1500
  `);

  for (const row of result.rows) {
    const state = clean(row.state || row.state_code || "").toUpperCase();
    const title = row.title || row.name || row.subject;
    if (!title) continue;

    const task = addEntity(entities, {
      entity_type: "task",
      entity_name: title,
      state,
      category: row.source || row.category || row.type,
      source_table: "tasks",
      metadata: { task_id: row.id, status: row.status },
    });

    if (task && state) {
      const stateNode = addEntity(entities, {
        entity_type: "state",
        entity_name: state,
        state,
        source_table: "modeled_states",
      });

      addEdge(edges, task, stateNode, {
        relationship_type: "requires_action_in",
        weight: ["critical", "high"].includes(String(row.priority || "").toLowerCase()) ? 2.6 : 1.3,
        strength: ["critical", "high"].includes(String(row.priority || "").toLowerCase()) ? 82 : 48,
        source_table: "tasks",
      });
    }
  }
}

async function collectDonors(client, entities, edges) {
  const candidateTables = ["donors", "donations", "contributions", "fec_contributions"];
  let table = null;

  for (const possible of candidateTables) {
    if (await tableExists(client, possible)) {
      table = possible;
      break;
    }
  }

  if (!table) return;

  const columns = await getColumns(client, table);
  const donorCol = firstCol(columns, ["donor_name", "name", "contributor_name", "individual_name"]);
  const candidateCol = firstCol(columns, ["candidate_name", "recipient_name", "committee_name"]);
  const stateCol = firstCol(columns, ["state", "state_code", "contributor_state"]);
  const amountCol = firstCol(columns, ["amount", "contribution_amount", "total_amount", "receipt_amount"]);

  if (!donorCol) return;

  const result = await client.query(`
    SELECT *
    FROM ${table}
    ORDER BY id DESC
    LIMIT 3000
  `);

  for (const row of result.rows) {
    const state = clean(stateCol ? row[stateCol] : "").toUpperCase();

    const donor = addEntity(entities, {
      entity_type: "donor",
      entity_name: row[donorCol],
      state,
      source_table: table,
      metadata: { donor_source_id: row.id },
    });

    const recipient = candidateCol
      ? addEntity(entities, {
          entity_type: String(row[candidateCol] || "").toLowerCase().includes("committee") ? "committee" : "candidate",
          entity_name: row[candidateCol],
          state,
          source_table: table,
        })
      : null;

    if (donor && recipient) {
      addEdge(edges, donor, recipient, {
        relationship_type: "funds",
        weight: 2.8,
        strength: Math.min(95, 45 + Math.log10(Math.max(1, n(amountCol ? row[amountCol] : 0))) * 12),
        value: amountCol ? row[amountCol] : 0,
        source_table: table,
      });
    }
  }
}

function addModeledStates(entities) {
  for (const state of STATES) {
    addEntity(entities, {
      entity_type: "state",
      entity_name: state,
      state,
      source_table: "modeled_states",
    });
  }
}

function scoreEntities(entities, edges) {
  const entityList = [...entities.values()];
  const edgeList = [...edges.values()];

  const stats = new Map();

  for (const entity of entityList) {
    stats.set(entity.entity_key, {
      direct: new Set(),
      weighted: 0,
      value: 0,
      maxStrength: 0,
      sourceTables: new Set(entity.source_tables || []),
    });
  }

  for (const edge of edgeList) {
    const source = stats.get(edge.source_key);
    const target = stats.get(edge.target_key);

    if (source) {
      source.direct.add(edge.target_key);
      source.weighted += n(edge.weight) * (n(edge.strength, 50) / 50);
      source.value += n(edge.value);
      source.maxStrength = Math.max(source.maxStrength, n(edge.strength));
      if (edge.source_table) source.sourceTables.add(edge.source_table);
    }

    if (target) {
      target.direct.add(edge.source_key);
      target.weighted += n(edge.weight) * (n(edge.strength, 50) / 50);
      target.value += n(edge.value);
      target.maxStrength = Math.max(target.maxStrength, n(edge.strength));
      if (edge.source_table) target.sourceTables.add(edge.source_table);
    }
  }

  for (const entity of entityList) {
    const stat = stats.get(entity.entity_key) || {
      direct: new Set(),
      weighted: 0,
      value: 0,
      maxStrength: 0,
      sourceTables: new Set(),
    };

    const typeWeight = ENTITY_WEIGHTS[entity.entity_type] || 1;
    const directConnections = stat.direct.size;
    const weightedConnectionScore = stat.weighted;
    const moneyBoost = Math.min(18, Math.log10(Math.max(1, stat.value)) * 2.4);
    const sourceBoost = Math.min(12, stat.sourceTables.size * 3);
    const centrality = clamp(directConnections * 8 + weightedConnectionScore * 5);
    const reach = clamp(directConnections * 6 + sourceBoost + moneyBoost);
    const momentum = clamp(stat.maxStrength * 0.42 + sourceBoost);
    const risk = clamp((centrality * 0.35) + (momentum * 0.35) + (entity.entity_type === "task" ? 25 : 0));
    const influence = clamp((centrality * 0.42 + reach * 0.28 + momentum * 0.2 + sourceBoost) * typeWeight);

    entity.influence_score = Math.round(influence);
    entity.centrality_score = Math.round(centrality);
    entity.reach_score = Math.round(reach);
    entity.momentum_score = Math.round(momentum);
    entity.risk_score = Math.round(risk);
    entity.total_connections = directConnections;
    entity.direct_connections = directConnections;
    entity.second_degree_connections = 0;
    entity.weighted_connection_score = Number(weightedConnectionScore.toFixed(2));
    entity.source_count = stat.sourceTables.size || entity.source_count || 0;
    entity.source_tables = [...stat.sourceTables];
  }

  return entityList;
}

async function persistInfluence(client, entities, edges) {
  for (const entity of entities) {
    await client.query(
      `
        INSERT INTO influence_entities (
          entity_key,
          entity_type,
          entity_name,
          state,
          office,
          party,
          category,
          influence_score,
          centrality_score,
          reach_score,
          momentum_score,
          risk_score,
          total_connections,
          direct_connections,
          second_degree_connections,
          weighted_connection_score,
          source_count,
          source_tables,
          metadata,
          calculated_at,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,NOW(),NOW()
        )
        ON CONFLICT (entity_key)
        DO UPDATE SET
          entity_type = EXCLUDED.entity_type,
          entity_name = EXCLUDED.entity_name,
          state = EXCLUDED.state,
          office = EXCLUDED.office,
          party = EXCLUDED.party,
          category = EXCLUDED.category,
          influence_score = EXCLUDED.influence_score,
          centrality_score = EXCLUDED.centrality_score,
          reach_score = EXCLUDED.reach_score,
          momentum_score = EXCLUDED.momentum_score,
          risk_score = EXCLUDED.risk_score,
          total_connections = EXCLUDED.total_connections,
          direct_connections = EXCLUDED.direct_connections,
          second_degree_connections = EXCLUDED.second_degree_connections,
          weighted_connection_score = EXCLUDED.weighted_connection_score,
          source_count = EXCLUDED.source_count,
          source_tables = EXCLUDED.source_tables,
          metadata = EXCLUDED.metadata,
          calculated_at = NOW(),
          updated_at = NOW()
      `,
      [
        entity.entity_key,
        entity.entity_type,
        entity.entity_name,
        entity.state || null,
        entity.office || null,
        entity.party || null,
        entity.category || null,
        entity.influence_score || 0,
        entity.centrality_score || 0,
        entity.reach_score || 0,
        entity.momentum_score || 0,
        entity.risk_score || 0,
        entity.total_connections || 0,
        entity.direct_connections || 0,
        entity.second_degree_connections || 0,
        entity.weighted_connection_score || 0,
        entity.source_count || 0,
        JSON.stringify(entity.source_tables || []),
        JSON.stringify(entity.metadata || {}),
      ]
    );
  }

  for (const edge of edges) {
    await client.query(
      `
        INSERT INTO influence_edges (
          source_key,
          target_key,
          source_type,
          target_type,
          relationship_type,
          state,
          weight,
          strength,
          value,
          source_table,
          metadata,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW())
        ON CONFLICT (source_key, target_key, relationship_type, source_table)
        DO UPDATE SET
          source_type = EXCLUDED.source_type,
          target_type = EXCLUDED.target_type,
          state = EXCLUDED.state,
          weight = EXCLUDED.weight,
          strength = EXCLUDED.strength,
          value = EXCLUDED.value,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `,
      [
        edge.source_key,
        edge.target_key,
        edge.source_type,
        edge.target_type,
        edge.relationship_type,
        edge.state || null,
        edge.weight || 1,
        edge.strength || 50,
        edge.value || 0,
        edge.source_table || "modeled",
        JSON.stringify(edge.metadata || {}),
      ]
    );
  }
}

async function generateAlerts(client) {
  const rows = await client.query(`
    SELECT *
    FROM influence_entities
    WHERE influence_score >= 75
    ORDER BY influence_score DESC
    LIMIT 50
  `);

  const alerts = [];

  for (const entity of rows.rows) {
    const severity = n(entity.influence_score) >= 90 ? "critical" : n(entity.influence_score) >= 82 ? "high" : "medium";
    const alertKey = `influence::${entity.entity_key}::${Math.round(n(entity.influence_score))}`;

    const title = `${entity.entity_name} is a high-influence ${entity.entity_type}`;
    const detail = `${entity.entity_name} has ${entity.total_connections || 0} direct graph connections and an influence score of ${Math.round(n(entity.influence_score))}/100.`;

    await client.query(
      `
        INSERT INTO influence_alerts (
          alert_key,
          entity_key,
          entity_type,
          entity_name,
          state,
          severity,
          title,
          detail,
          influence_score,
          change_score,
          metadata,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW())
        ON CONFLICT (alert_key)
        DO UPDATE SET
          severity = EXCLUDED.severity,
          title = EXCLUDED.title,
          detail = EXCLUDED.detail,
          influence_score = EXCLUDED.influence_score,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `,
      [
        alertKey,
        entity.entity_key,
        entity.entity_type,
        entity.entity_name,
        entity.state,
        severity,
        title,
        detail,
        entity.influence_score,
        0,
        JSON.stringify({ source: "influence_engine" }),
      ]
    );

    alerts.push({
      alert_key: alertKey,
      entity_key: entity.entity_key,
      entity_type: entity.entity_type,
      entity_name: entity.entity_name,
      state: entity.state,
      severity,
      title,
      detail,
      influence_score: n(entity.influence_score),
    });
  }

  return alerts;
}

async function saveSnapshot(client, summary, rankings, stateRankings, alerts) {
  const snapshotKey = `influence::${new Date().toISOString().slice(0, 13)}`;

  await client.query(
    `
      INSERT INTO influence_snapshots (
        snapshot_key,
        summary,
        rankings,
        state_rankings,
        alerts
      )
      VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb)
      ON CONFLICT (snapshot_key)
      DO UPDATE SET
        summary = EXCLUDED.summary,
        rankings = EXCLUDED.rankings,
        state_rankings = EXCLUDED.state_rankings,
        alerts = EXCLUDED.alerts
    `,
    [
      snapshotKey,
      JSON.stringify(summary),
      JSON.stringify(rankings),
      JSON.stringify(stateRankings),
      JSON.stringify(alerts),
    ]
  );
}

export async function syncInfluenceEngine() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureInfluenceSchema(client);

    const entities = new Map();
    const edges = new Map();

    addModeledStates(entities);
    await collectCandidates(client, entities, edges);
    await collectEndorsements(client, entities, edges);
    await collectVendors(client, entities, edges);
    await collectTasks(client, entities, edges);
    await collectDonors(client, entities, edges);

    const scoredEntities = scoreEntities(entities, edges);
    const edgeList = [...edges.values()];

    await persistInfluence(client, scoredEntities, edgeList);

    const rankings = scoredEntities
      .sort((a, b) => n(b.influence_score) - n(a.influence_score))
      .slice(0, 100);

    const stateRankings = {};
    for (const state of STATES) {
      stateRankings[state] = scoredEntities
        .filter((entity) => entity.state === state)
        .sort((a, b) => n(b.influence_score) - n(a.influence_score))
        .slice(0, 20);
    }

    const alerts = await generateAlerts(client);

    const summary = {
      total_entities: scoredEntities.length,
      total_edges: edgeList.length,
      states_covered: STATES.filter((state) => scoredEntities.some((entity) => entity.state === state)).length,
      top_score: rankings[0]?.influence_score || 0,
      critical_alerts: alerts.filter((alert) => alert.severity === "critical").length,
      high_alerts: alerts.filter((alert) => alert.severity === "high").length,
      generated_at: new Date().toISOString(),
    };

    await saveSnapshot(client, summary, rankings, stateRankings, alerts);

    await client.query("COMMIT");

    return {
      ok: true,
      summary,
      rankings,
      state_rankings: stateRankings,
      alerts,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getInfluenceSummary() {
  await ensureInfluenceSchema(pool);

  const summary = await pool.query(`
    SELECT
      COUNT(*)::int AS total_entities,
      COUNT(*) FILTER (WHERE influence_score >= 90)::int AS elite_entities,
      COUNT(*) FILTER (WHERE influence_score >= 75)::int AS high_influence_entities,
      COUNT(DISTINCT state)::int AS states_covered,
      ROUND(AVG(influence_score), 2) AS avg_influence,
      MAX(influence_score) AS top_influence
    FROM influence_entities
  `);

  const byType = await pool.query(`
    SELECT entity_type, COUNT(*)::int AS count, ROUND(AVG(influence_score), 2) AS avg_score
    FROM influence_entities
    GROUP BY entity_type
    ORDER BY count DESC
  `);

  const byState = await pool.query(`
    SELECT state, COUNT(*)::int AS entities, ROUND(AVG(influence_score), 2) AS avg_score, MAX(influence_score) AS top_score
    FROM influence_entities
    WHERE state IS NOT NULL AND state <> ''
    GROUP BY state
    ORDER BY top_score DESC NULLS LAST
  `);

  const edges = await pool.query(`SELECT COUNT(*)::int AS total_edges FROM influence_edges`);

  return {
    summary: {
      ...(summary.rows[0] || {}),
      total_edges: edges.rows?.[0]?.total_edges || 0,
    },
    by_type: byType.rows,
    by_state: byState.rows,
  };
}

export async function getInfluenceRankings({ state = "", type = "", limit = 50 } = {}) {
  await ensureInfluenceSchema(pool);

  const params = [];
  const where = [];

  if (state) {
    params.push(String(state).toUpperCase());
    where.push(`state = $${params.length}`);
  }

  if (type) {
    params.push(String(type).toLowerCase());
    where.push(`entity_type = $${params.length}`);
  }

  params.push(Math.min(250, Math.max(1, n(limit, 50))));

  const result = await pool.query(
    `
      SELECT *
      FROM influence_entities
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY influence_score DESC, total_connections DESC
      LIMIT $${params.length}
    `,
    params
  );

  return {
    results: result.rows,
    count: result.rows.length,
  };
}

export async function getInfluenceEntity({ entityKey = "", entityType = "", entityName = "", state = "" } = {}) {
  await ensureInfluenceSchema(pool);

  let key = entityKey;

  if (!key && entityType && entityName) {
    key = keyFor(entityType, entityName, state);
  }

  let entity = null;

  if (key) {
    const result = await pool.query(`SELECT * FROM influence_entities WHERE entity_key = $1 LIMIT 1`, [key]);
    entity = result.rows?.[0] || null;
  }

  if (!entity && entityName) {
    const result = await pool.query(
      `
        SELECT *
        FROM influence_entities
        WHERE LOWER(entity_name) = LOWER($1)
        ${state ? "AND state = $2" : ""}
        ORDER BY influence_score DESC
        LIMIT 1
      `,
      state ? [entityName, String(state).toUpperCase()] : [entityName]
    );
    entity = result.rows?.[0] || null;
  }

  if (!entity) {
    return {
      entity: null,
      related: [],
      edges: [],
      alerts: [],
    };
  }

  const edges = await pool.query(
    `
      SELECT *
      FROM influence_edges
      WHERE source_key = $1 OR target_key = $1
      ORDER BY strength DESC
      LIMIT 100
    `,
    [entity.entity_key]
  );

  const relatedKeys = [
    ...new Set(
      edges.rows.map((edge) => (edge.source_key === entity.entity_key ? edge.target_key : edge.source_key))
    ),
  ];

  const related = relatedKeys.length
    ? await pool.query(
        `
          SELECT *
          FROM influence_entities
          WHERE entity_key = ANY($1)
          ORDER BY influence_score DESC
        `,
        [relatedKeys]
      )
    : { rows: [] };

  const alerts = await pool.query(
    `
      SELECT *
      FROM influence_alerts
      WHERE entity_key = $1
      ORDER BY created_at DESC
      LIMIT 20
    `,
    [entity.entity_key]
  );

  return {
    entity,
    related: related.rows,
    edges: edges.rows,
    alerts: alerts.rows,
  };
}

export async function getInfluenceAlerts({ state = "", severity = "", limit = 50 } = {}) {
  await ensureInfluenceSchema(pool);

  const params = [];
  const where = [`status = 'open'`];

  if (state) {
    params.push(String(state).toUpperCase());
    where.push(`state = $${params.length}`);
  }

  if (severity) {
    params.push(String(severity).toLowerCase());
    where.push(`LOWER(severity) = $${params.length}`);
  }

  params.push(Math.min(200, Math.max(1, n(limit, 50))));

  const result = await pool.query(
    `
      SELECT *
      FROM influence_alerts
      WHERE ${where.join(" AND ")}
      ORDER BY influence_score DESC, created_at DESC
      LIMIT $${params.length}
    `,
    params
  );

  return {
    alerts: result.rows,
    count: result.rows.length,
  };
}
