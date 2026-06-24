import { pool } from "../db/pool.js";

const ALL_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC"
];

const SEED = [
  const STATE_NAMES = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia"
};
  [
    "National Teachers Coalition", 
    "Labor",
    "PA",
    "Senate",
    "Pennsylvania Senate Candidate",
    "Democratic",
    86,
    78,
    82,
    64,
    "Confirmed",
    "Modeled labor endorsement signal for a high-priority statewide race."
  ],
  [
    "Sun Belt Business Alliance",
    "Business Group",
    "AZ",
    "House",
    "Arizona House Candidate",
    "Republican",
    74,
    68,
    72,
    58,
    "Watch",
    "Modeled business coalition endorsement signal with regional donor-network relevance."
  ],
  [
    "Great Lakes Public Safety PAC",
    "PAC",
    "MI",
    "House",
    "Michigan House Candidate",
    "Democratic",
    79,
    64,
    76,
    81,
    "Confirmed",
    "Modeled PAC endorsement signal connected to finance and regional influence."
  ],
  [
    "Georgia Faith & Families Network",
    "Community Leader",
    "GA",
    "Statewide",
    "Georgia Statewide Candidate",
    "Republican",
    83,
    81,
    70,
    44,
    "Confirmed",
    "Modeled grassroots endorsement signal with coalition reach and turnout relevance."
  ],
  [
    "Nevada Working Families Council",
    "Advocacy Group",
    "NV",
    "Senate",
    "Nevada Senate Candidate",
    "Democratic",
    88,
    85,
    79,
    61,
    "Confirmed",
    "Modeled advocacy endorsement signal for battleground persuasion and turnout."
  ],
  [
    "Texas Energy Jobs Coalition",
    "Business Group",
    "TX",
    "Senate",
    "Texas Senate Candidate",
    "Republican",
    81,
    73,
    77,
    69,
    "Watch",
    "Modeled industry coalition endorsement signal with donor and vendor-network relevance."
  ]
];

export const ENDORSEMENT_TYPES = [
  "Elected Official",
  "Labor",
  "PAC",
  "Organization",
  "Newspaper",
  "Community Leader",
  "Business Group",
  "Advocacy Group",
  "Party Committee",
  "Coalition"
];

function t(v = "") {
  return String(v ?? "").trim();
}

function n(v = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function clamp(v) {
  return Math.max(0, Math.min(100, n(v)));
}

function tier(score) {
  const s = n(score);

  if (s >= 85) return "Tier 1";
  if (s >= 70) return "Tier 2";
  if (s >= 50) return "Tier 3";

  return "Monitor";
}

function risk(score, status = "") {
  const s = n(score);
  const st = t(status).toLowerCase();

  if (st.includes("watch") || s >= 85) return "High";
  if (s >= 70) return "Elevated";
  if (s >= 50) return "Watch";

  return "Stable";
}

export function scoreEndorsement(row = {}) {
  return clamp(
    Math.round(
      clamp(row.influence_score) * 0.35 +
      clamp(row.reach_score) * 0.25 +
      clamp(row.network_score) * 0.25 +
      clamp(row.financial_signal_score) * 0.15
    )
  );
}

function normalized(row = {}) {
  const score = n(
    row.endorsement_score || scoreEndorsement(row)
  );

  function buildModeledStateEndorsements() {
  return ALL_STATES.flatMap((state) => {
    const stateName = STATE_NAMES[state] || state;

    return [
      [
        `${state} Civic Leadership Council`,
        "Coalition",
        state,
        "Statewide",
        `${stateName} Statewide Candidate`,
        "Nonpartisan",
        68,
        62,
        66,
        42,
        "Modeled",
        `Modeled civic endorsement signal for ${stateName}.`
      ],

      [
        `${state} Working Families Alliance`,
        "Labor",
        state,
        "Statewide",
        `${stateName} Statewide Candidate`,
        "Nonpartisan",
        76,
        72,
        70,
        48,
        "Modeled",
        `Modeled labor endorsement signal for ${stateName}.`
      ],

      [
        `${state} Business Leadership Network`,
        "Business Group",
        state,
        "Statewide",
        `${stateName} Statewide Candidate`,
        "Nonpartisan",
        64,
        61,
        67,
        55,
        "Modeled",
        `Modeled business endorsement signal for ${stateName}.`
      ]
    ];
  });
}

  return {
    ...row,
    endorsement_score: score,
    endorsement_tier:
      row.endorsement_tier || tier(score),
    risk_label:
      row.risk_label || risk(score, row.status)
  };
}

export async function ensureEndorsementsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS endorsements (
      id SERIAL PRIMARY KEY,
      candidate_id TEXT,
      candidate_name TEXT,
      candidate_party TEXT,
      state TEXT,
      office TEXT,
      district TEXT,
      endorser_name TEXT NOT NULL,
      endorser_type TEXT DEFAULT 'Organization',
      endorser_party TEXT,
      party TEXT,
      influence_score NUMERIC DEFAULT 50,
      reach_score NUMERIC DEFAULT 50,
      network_score NUMERIC DEFAULT 50,
      financial_signal_score NUMERIC DEFAULT 25,
      endorsement_score NUMERIC DEFAULT 50,
      endorsement_tier TEXT DEFAULT 'Tier 3',
      risk_label TEXT DEFAULT 'Watch',
      status TEXT DEFAULT 'Confirmed',
      source TEXT DEFAULT 'manual',
      source_url TEXT,
      summary TEXT,
      notes TEXT,
      announced_at DATE,
      source_updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const cols = [
    ["candidate_id", "TEXT"],
    ["candidate_name", "TEXT"],
    ["candidate_party", "TEXT"],
    ["state", "TEXT"],
    ["office", "TEXT"],
    ["district", "TEXT"],
    ["endorser_name", "TEXT"],
    ["endorser_type", "TEXT DEFAULT 'Organization'"],
    ["endorser_party", "TEXT"],
    ["party", "TEXT"],
    ["influence_score", "NUMERIC DEFAULT 50"],
    ["reach_score", "NUMERIC DEFAULT 50"],
    ["network_score", "NUMERIC DEFAULT 50"],
    ["financial_signal_score", "NUMERIC DEFAULT 25"],
    ["endorsement_score", "NUMERIC DEFAULT 50"],
    ["endorsement_tier", "TEXT DEFAULT 'Tier 3'"],
    ["risk_label", "TEXT DEFAULT 'Watch'"],
    ["status", "TEXT DEFAULT 'Confirmed'"],
    ["source", "TEXT DEFAULT 'manual'"],
    ["source_url", "TEXT"],
    ["summary", "TEXT"],
    ["notes", "TEXT"],
    ["announced_at", "DATE"],
    ["source_updated_at", "TIMESTAMP DEFAULT NOW()"],
    ["created_at", "TIMESTAMP DEFAULT NOW()"],
    ["updated_at", "TIMESTAMP DEFAULT NOW()"]
  ];

  for (const [column, type] of cols) {
    await pool.query(`
      ALTER TABLE endorsements
      ADD COLUMN IF NOT EXISTS ${column} ${type}
    `);
  }

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_endorsements_state
    ON endorsements(state)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_endorsements_score
    ON endorsements(endorsement_score DESC)
  `);
}

export async function seedEndorsementsIfEmpty() {
  await ensureEndorsementsTable();

  const count = await pool.query(`
    SELECT COUNT(*)::int AS total
    FROM endorsements
  `);

  if (Number(count.rows[0]?.total || 0) > 0) {
    return {
      inserted: 0,
      skipped: true
    };
  }

  let inserted = 0;

  const seedRows = [
  ...SEED,
  ...buildModeledStateEndorsements()
];

for (const row of seedRows) {
    const [
      endorser_name,
      endorser_type,
      state,
      office,
      candidate_name,
      candidate_party,
      influence_score,
      reach_score,
      network_score,
      financial_signal_score,
      status,
      summary
    ] = row;

    const score = scoreEndorsement({
      influence_score,
      reach_score,
      network_score,
      financial_signal_score
    });

    await pool.query(`
      INSERT INTO endorsements (
        endorser_name,
        endorser_type,
        state,
        office,
        candidate_name,
        candidate_party,
        influence_score,
        reach_score,
        network_score,
        financial_signal_score,
        endorsement_score,
        endorsement_tier,
        risk_label,
        status,
        source,
        summary,
        notes,
        source_updated_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,
        $11,$12,$13,$14,
        'modeled_baseline',
        $15,
        'Baseline modeled endorsement intelligence. Replace with verified records when available.',
        NOW(),
        NOW()
      )
    `, [
      endorser_name,
      endorser_type,
      state,
      office,
      candidate_name,
      candidate_party,
      influence_score,
      reach_score,
      network_score,
      financial_signal_score,
      score,
      tier(score),
      risk(score, status),
      status,
      summary
    ]);

    inserted++;
  }

  return {
    inserted,
    skipped: false
  };
}

function where(query = {}) {
  const values = [];
  const clauses = [];

  const add = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (t(query.state)) {
    clauses.push(
      `UPPER(COALESCE(state,'')) = UPPER(${add(
        t(query.state)
      )})`
    );
  }

  if (t(query.office)) {
    clauses.push(
      `COALESCE(office,'') ILIKE '%' || ${add(
        t(query.office)
      )} || '%'`
    );
  }

  if (t(query.type || query.endorser_type)) {
    clauses.push(
      `COALESCE(endorser_type,'') ILIKE '%' || ${add(
        t(query.type || query.endorser_type)
      )} || '%'`
    );
  }

  return {
    sql: clauses.length
      ? `WHERE ${clauses.join(" AND ")}`
      : "",
    vals: values
  };
}

export async function listEndorsements(query = {}) {
  await seedEndorsementsIfEmpty();

  const limit = Math.max(
    1,
    Math.min(Number(query.limit || 100), 250)
  );

  const offset = Math.max(
    0,
    Number(query.offset || 0)
  );

  const { sql, vals } = where(query);

  const rows = await pool.query(
    `
      SELECT *
      FROM endorsements
      ${sql}
      ORDER BY
        COALESCE(endorsement_score,0) DESC,
        COALESCE(influence_score,0) DESC,
        endorser_name ASC
      LIMIT $${vals.length + 1}
      OFFSET $${vals.length + 2}
    `,
    [...vals, limit, offset]
  );

  const total = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM endorsements
      ${sql}
    `,
    vals
  );

  return {
    total: Number(total.rows[0]?.total || 0),
    results: rows.rows.map(normalized)
  };
}

export async function getEndorsementSummary(q = {}) {
  await seedEndorsementsIfEmpty();

  const { sql, vals } = where(q);

  const summary = await pool.query(
    `
      SELECT
        COUNT(*)::int total_endorsements,
        COUNT(DISTINCT NULLIF(state,''))::int states_covered,
        COUNT(DISTINCT NULLIF(candidate_name,''))::int candidates_touched,
        COUNT(DISTINCT NULLIF(endorser_type,''))::int endorser_types,
        COALESCE(AVG(COALESCE(endorsement_score,0)),0)::numeric avg_score,
        COUNT(*) FILTER (WHERE COALESCE(endorsement_score,0)>=85)::int tier_one,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) LIKE '%watch%')::int watch_items
      FROM endorsements
      ${sql}
    `,
    vals
  );

  const byType = await pool.query(
    `
      SELECT
        COALESCE(endorser_type,'Organization') endorser_type,
        COUNT(*)::int total,
        COALESCE(AVG(COALESCE(endorsement_score,0)),0)::numeric avg_score
      FROM endorsements
      ${sql}
      GROUP BY COALESCE(endorser_type,'Organization')
      ORDER BY total DESC, avg_score DESC
      LIMIT 12
    `,
    vals
  );

  const byState = await pool.query(
    `
      SELECT
        COALESCE(state,'National') state,
        COUNT(*)::int total,
        COALESCE(AVG(COALESCE(endorsement_score,0)),0)::numeric avg_score,
        MAX(COALESCE(endorsement_score,0))::numeric top_score
      FROM endorsements
      ${sql}
      GROUP BY COALESCE(state,'National')
      ORDER BY top_score DESC,total DESC
      LIMIT 20
    `,
    vals
  );

  const top = await pool.query(
    `
      SELECT *
      FROM endorsements
      ${sql}
      ORDER BY COALESCE(endorsement_score,0) DESC
      LIMIT 8
    `,
    vals
  );

  const s = summary.rows[0] || {};

  return {
    summary: {
      total_endorsements: n(s.total_endorsements),
      states_covered: n(s.states_covered),
      candidates_touched: n(s.candidates_touched),
      endorser_types: n(s.endorser_types),
      avg_score: Math.round(n(s.avg_score)),
      tier_one: n(s.tier_one),
      watch_items: n(s.watch_items),
    },
    by_type: byType.rows.map((row) => ({
      ...row,
      avg_score: Math.round(n(row.avg_score)),
    })),
    by_state: byState.rows.map((row) => ({
      ...row,
      avg_score: Math.round(n(row.avg_score)),
      top_score: Math.round(n(row.top_score)),
    })),
    top_endorsements: top.rows.map(normalized),
  };
}

export async function getEndorsementOptions() {
  await seedEndorsementsIfEmpty();

  const [states, offices, types, statuses] = await Promise.all([
    pool.query(`
      SELECT DISTINCT state
      FROM endorsements
      WHERE COALESCE(state,'') <> ''
      ORDER BY state
    `),
    pool.query(`
      SELECT DISTINCT endorser_type
      FROM endorsements
      WHERE COALESCE(endorser_type,'') <> ''
      ORDER BY endorser_type
    `),
    pool.query(`
      SELECT DISTINCT status
      FROM endorsements
      WHERE COALESCE(status,'') <> ''
      ORDER BY status
    `),
  ]);

  const dbStates = states.rows.map((row) => row.state).filter(Boolean);
  const mergedStates = Array.from(new Set([...ALL_STATES, ...dbStates])).sort();

  return {
    states: mergedStates,
    offices: offices.rows.map((row) => row.office),
    types: types.rows.map((row) => row.endorser_type),
    statuses: statuses.rows.map((row) => row.status),
    default_types: ENDORSEMENT_TYPES,
  };
}

export async function createEndorsement(payload = {}) {
  await ensureEndorsementsTable();

  const score = scoreEndorsement(payload);

  const vals = [
    t(payload.candidate_id) || null,
    t(payload.candidate_name) || null,
    t(payload.candidate_party) || null,
    t(payload.state).toUpperCase() || null,
    t(payload.office) || null,
    t(payload.district) || null,
    t(payload.endorser_name) || "Unnamed Endorser",
    t(payload.endorser_type) || "Organization",
    t(payload.endorser_party) || null,
    t(payload.party) || null,
    clamp(payload.influence_score ?? 50),
    clamp(payload.reach_score ?? 50),
    clamp(payload.network_score ?? 50),
    clamp(payload.financial_signal_score ?? 25),
    score,
    tier(score),
    risk(score, payload.status),
    t(payload.status) || "Confirmed",
    t(payload.source) || "manual",
    t(payload.source_url) || null,
    t(payload.summary) || null,
    t(payload.notes) || null,
    payload.announced_at || null,
  ];

  const result = await pool.query(
    `
      INSERT INTO endorsements (
        candidate_id,
        candidate_name,
        candidate_party,
        state,
        office,
        district,
        endorser_name,
        endorser_type,
        endorser_party,
        party,
        influence_score,
        reach_score,
        network_score,
        financial_signal_score,
        endorsement_score,
        endorsement_tier,
        risk_label,
        status,
        source,
        source_url,
        summary,
        notes,
        announced_at,
        source_updated_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,NOW(),NOW()
      )
      RETURNING *
    `,
    vals
  );

  return normalized(result.rows[0]);
}

export async function updateEndorsement(id, payload = {}) {
  await ensureEndorsementsTable();

  const existing = await pool.query(
    `
      SELECT *
      FROM endorsements
      WHERE id = $1
    `,
    [id]
  );

  if (!existing.rows[0]) return null;

  const merged = {
    ...existing.rows[0],
    ...payload,
  };

  const score = scoreEndorsement(merged);

  const vals = [
    id,
    t(merged.candidate_id) || null,
    t(merged.candidate_name) || null,
    t(merged.candidate_party) || null,
    t(merged.state).toUpperCase() || null,
    t(merged.office) || null,
    t(merged.district) || null,
    t(merged.endorser_name) || "Unnamed Endorser",
    t(merged.endorser_type) || "Organization",
    t(merged.endorser_party) || null,
    t(merged.party) || null,
    clamp(merged.influence_score ?? 50),
    clamp(merged.reach_score ?? 50),
    clamp(merged.network_score ?? 50),
    clamp(merged.financial_signal_score ?? 25),
    score,
    tier(score),
    risk(score, merged.status),
    t(merged.status) || "Confirmed",
    t(merged.source) || "manual",
    t(merged.source_url) || null,
    t(merged.summary) || null,
    t(merged.notes) || null,
    merged.announced_at || null,
  ];

  const result = await pool.query(
    `
      UPDATE endorsements
      SET
        candidate_id = $2,
        candidate_name = $3,
        candidate_party = $4,
        state = $5,
        office = $6,
        district = $7,
        endorser_name = $8,
        endorser_type = $9,
        endorser_party = $10,
        party = $11,
        influence_score = $12,
        reach_score = $13,
        network_score = $14,
        financial_signal_score = $15,
        endorsement_score = $16,
        endorsement_tier = $17,
        risk_label = $18,
        status = $19,
        source = $20,
        source_url = $21,
        summary = $22,
        notes = $23,
        announced_at = $24,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    vals
  );

  return normalized(result.rows[0]);
}

export async function deleteEndorsement(id) {
  await ensureEndorsementsTable();

  const result = await pool.query(
    `
      DELETE FROM endorsements
      WHERE id = $1
      RETURNING id
    `,
    [id]
  );

  return Boolean(result.rows[0]);
}

async function tableExists(name) {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) exists
    `,
    [name]
  );

  return Boolean(result.rows[0]?.exists);
}

async function candidateColumns() {
  if (!(await tableExists("candidates"))) return [];

  const result = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'candidates'
  `);

  return result.rows.map((row) => row.column_name);
}

function nameSql(columns) {
  if (columns.includes("full_name")) return "full_name";
  if (columns.includes("name")) return "name";
  if (columns.includes("candidate_name")) return "candidate_name";

  if (
    columns.includes("first_name") &&
    columns.includes("last_name")
  ) {
    return "CONCAT_WS(' ', first_name, last_name)";
  }

  return "NULL";
}

export async function syncAllStateModeledEndorsements() {
  await ensureEndorsementsTable();

  const seedRows = buildModeledStateEndorsements();

  let inserted = 0;

  for (const row of seedRows) {
    const [endorser_name, , state] = row;

    const exists = await pool.query(
      `
      SELECT id
      FROM endorsements
      WHERE LOWER(COALESCE(endorser_name,'')) = LOWER($1)
      AND UPPER(COALESCE(state,'')) = UPPER($2)
      LIMIT 1
      `,
      [endorser_name, state]
    );

    if (exists.rows[0]) continue;

    const [
      ,
      endorser_type,
      ,
      office,
      candidate_name,
      candidate_party,
      influence_score,
      reach_score,
      network_score,
      financial_signal_score,
      status,
      summary
    ] = row;

    const score = scoreEndorsement({
      influence_score,
      reach_score,
      network_score,
      financial_signal_score
    });

    await pool.query(
      `
      INSERT INTO endorsements (
        endorser_name,
        endorser_type,
        state,
        office,
        candidate_name,
        candidate_party,
        influence_score,
        reach_score,
        network_score,
        financial_signal_score,
        endorsement_score,
        endorsement_tier,
        risk_label,
        status,
        source,
        summary,
        notes,
        source_updated_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,
        $11,$12,$13,$14,
        'state_modeled_baseline',
        $15,
        'Generated statewide endorsement baseline',
        NOW(),
        NOW()
      )
      `,
      [
        endorser_name,
        endorser_type,
        state,
        office,
        candidate_name,
        candidate_party,
        influence_score,
        reach_score,
        network_score,
        financial_signal_score,
        score,
        tier(score),
        risk(score, status),
        status,
        summary
      ]
    );

    inserted++;
  }

  return {
    inserted,
    states_processed: ALL_STATES.length
  };
}

export async function syncModeledEndorsements({ limit = 50 } = {}) {
  await ensureEndorsementsTable();

  if (!(await tableExists("candidates"))) {
    return seedEndorsementsIfEmpty();
  }

  const columns = await candidateColumns();

  const nameExpression = nameSql(columns);
  const idExpression = columns.includes("id") ? "id" : "NULL";
  const stateExpression = columns.includes("state")
    ? "state"
    : columns.includes("state_code")
    ? "state_code"
    : "NULL";
  const officeExpression = columns.includes("office")
    ? "office"
    : "NULL";
  const partyExpression = columns.includes("party")
    ? "party"
    : "NULL";

  const candidates = await pool.query(
    `
      SELECT
        ${idExpression} id,
        ${nameExpression} candidate_name,
        ${stateExpression} state,
        ${officeExpression} office,
        ${partyExpression} party
      FROM candidates
      WHERE ${nameExpression} IS NOT NULL
      ORDER BY id DESC NULLS LAST
      LIMIT $1
    `,
    [Math.max(1, Math.min(Number(limit || 50), 100))]
  );

  let inserted = 0;

  for (const candidate of candidates.rows) {
    const state = t(candidate.state).toUpperCase() || "US";

    const items = [
      [
        `${state} Civic Leadership Council`,
        "Coalition",
        68,
        62,
        66,
        42,
      ],
      [
        `${state} Working Families Alliance`,
        "Labor",
        76,
        72,
        70,
        48,
      ],
    ];

    for (const [
      endorser_name,
      endorser_type,
      influence_score,
      reach_score,
      network_score,
      financial_signal_score,
    ] of items) {
      const exists = await pool.query(
        `
          SELECT id
          FROM endorsements
          WHERE COALESCE(candidate_id,'') = $1
            AND LOWER(COALESCE(endorser_name,'')) = LOWER($2)
          LIMIT 1
        `,
        [
          String(candidate.id || ""),
          endorser_name,
        ]
      );

      if (exists.rows[0]) continue;

      await createEndorsement({
        candidate_id: candidate.id
          ? String(candidate.id)
          : null,
        candidate_name:
          t(candidate.candidate_name) || "Candidate",
        candidate_party: t(candidate.party),
        state,
        office: t(candidate.office) || "Campaign",
        endorser_name,
        endorser_type,
        influence_score,
        reach_score,
        network_score,
        financial_signal_score,
        status: "Modeled",
        source: "candidate_modeled",
        summary: `Modeled endorsement intelligence generated for ${
          t(candidate.candidate_name) || "Candidate"
        }. Replace with verified endorsements when confirmed.`,
      });

      inserted++;
    }
  }

  return {
    inserted,
    candidates_processed: candidates.rows.length,
  };
}

export function buildTaskPayloadFromEndorsement(endorsement = {}) {
  const score = n(endorsement.endorsement_score);

  return {
    title: `${endorsement.state || "National"} endorsement review: ${
      endorsement.endorser_name || "Endorser"
    }`,
    description:
      endorsement.summary ||
      `${
        endorsement.endorser_name || "Endorser"
      } endorsed ${
        endorsement.candidate_name || "a candidate"
      }. Review coalition impact, donor proximity, and campaign response.`,
    source: "endorsement_intelligence",
    state: endorsement.state || "National",
    office: endorsement.office || "Statewide",
    priority:
      score >= 85
        ? "high"
        : score >= 70
        ? "medium"
        : "normal",
    status: "open",
    assigned_to: "Political Intelligence",
    due_label: score >= 85 ? "Today" : "This Week",
    metadata: {
      endorsement_id: endorsement.id,
      endorser_name: endorsement.endorser_name,
      endorser_type: endorsement.endorser_type,
      candidate_name: endorsement.candidate_name,
      endorsement_score: endorsement.endorsement_score,
      risk_label: endorsement.risk_label,
      source: "endorsement_intelligence",
    },
  };
}
