import { pool } from "../db/pool.js";
import { ensureFundraisingLiveTable } from "./fec.service.js";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeStateName(value = "") {
  const raw = String(value || "").trim().toUpperCase();
  const map = {
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

  return map[raw] || value || "";
}

function stateCode(value = "") {
  const raw = String(value || "").trim();
  if (raw.length === 2) return raw.toUpperCase();

  const reverse = {
    Alabama: "AL",
    Alaska: "AK",
    Arizona: "AZ",
    Arkansas: "AR",
    California: "CA",
    Colorado: "CO",
    Connecticut: "CT",
    Delaware: "DE",
    Florida: "FL",
    Georgia: "GA",
    Hawaii: "HI",
    Idaho: "ID",
    Illinois: "IL",
    Indiana: "IN",
    Iowa: "IA",
    Kansas: "KS",
    Kentucky: "KY",
    Louisiana: "LA",
    Maine: "ME",
    Maryland: "MD",
    Massachusetts: "MA",
    Michigan: "MI",
    Minnesota: "MN",
    Mississippi: "MS",
    Missouri: "MO",
    Montana: "MT",
    Nebraska: "NE",
    Nevada: "NV",
    "New Hampshire": "NH",
    "New Jersey": "NJ",
    "New Mexico": "NM",
    "New York": "NY",
    "North Carolina": "NC",
    "North Dakota": "ND",
    Ohio: "OH",
    Oklahoma: "OK",
    Oregon: "OR",
    Pennsylvania: "PA",
    "Rhode Island": "RI",
    "South Carolina": "SC",
    "South Dakota": "SD",
    Tennessee: "TN",
    Texas: "TX",
    Utah: "UT",
    Vermont: "VT",
    Virginia: "VA",
    Washington: "WA",
    "West Virginia": "WV",
    Wisconsin: "WI",
    Wyoming: "WY",
    "District of Columbia": "DC"
  };

  return reverse[raw] || raw;
}

function buildPriority(probability, receipts, vendorCount) {
  const probabilityNum = Number(String(probability || "").replace("%", "")) || 0;
  let score = 0;

  if (probabilityNum >= 49 && probabilityNum <= 57) score += 3;
  if (receipts >= 1_500_000) score += 2;
  if (vendorCount >= 2) score += 2;

  if (score >= 5) return "Tier 1";
  if (score >= 3) return "Tier 2";
  return "Tier 3";
}

function buildRisk(probability, vendorCount) {
  const probabilityNum = Number(String(probability || "").replace("%", "")) || 0;

  if (probabilityNum <= 51 && vendorCount <= 1) return "Elevated";
  if (probabilityNum <= 55 || vendorCount <= 2) return "Watch";
  return "Monitor";
}

function buildMomentum(rank) {
  const value = 2.4 - rank * 0.35;
  return value >= 0 ? `+${value.toFixed(1)}` : `${value.toFixed(1)}`;
}

export async function ensureExecutiveFeedEventsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS executive_feed_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      severity TEXT DEFAULT 'Medium',
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      state TEXT,
      office TEXT,
      risk TEXT DEFAULT 'Monitor',
      candidate_name TEXT,
      candidate_id TEXT,
      vendor_id INTEGER,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_executive_feed_events_created_at
    ON executive_feed_events (created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_executive_feed_events_state
    ON executive_feed_events (state)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_executive_feed_events_office
    ON executive_feed_events (office)
  `);
}

export async function getBattlegroundSignalRows(limit = 12) {
  const query = `
    with vendor_counts as (
      select
        upper(state) as state_code,
        count(*)::int as vendor_count
      from vendors
      where state is not null
        and state <> ''
      group by upper(state)
    ),
    finance as (
      select
        candidate_id,
        coalesce(receipts, 0) as receipts,
        coalesce(cash_on_hand, 0) as cash_on_hand
      from fundraising_live
    )
    select
      c.id,
      c.external_id,
      c.full_name as candidate,
      c.state,
      c.office,
      c.party,
      coalesce(f.receipts, 0) as receipts,
      coalesce(f.cash_on_hand, 0) as cash_on_hand,
      coalesce(v.vendor_count, 0) as vendor_count,
      c.last_imported_at
    from candidates c
    left join finance f
      on f.candidate_id = c.external_id
    left join vendor_counts v
      on v.state_code = upper(c.state)
    where c.state is not null
      and c.state <> ''
      and c.office is not null
      and c.office <> ''
      and c.office in ('Senate', 'House', 'Governor', 'President')
    order by
      coalesce(f.receipts, 0) desc,
      c.state asc,
      c.office asc,
      c.full_name asc
    limit $1
  `;

  const { rows } = await pool.query(query, [limit]);

  return (rows || []).map((row, index) => {
    const state = normalizeStateName(row.state);
    const code = stateCode(state);
    const baseProbability = Math.max(49, 58 - index);
    const probability = `${baseProbability}%`;
    const momentum = buildMomentum(index);
    const priority = buildPriority(probability, Number(row.receipts || 0), Number(row.vendor_count || 0));
    const risk = buildRisk(probability, Number(row.vendor_count || 0));

    return {
      id: row.id,
      external_id: row.external_id,
      race: `${code} ${row.office}`,
      candidate: row.candidate || "",
      state,
      state_code: code,
      office: row.office,
      probability,
      momentum,
      risk,
      priority,
      party: row.party || "",
      receipts: Number(row.receipts || 0),
      cash_on_hand: Number(row.cash_on_hand || 0),
      vendor_count: Number(row.vendor_count || 0),
      updated_at: row.last_imported_at || null
    };
  });
}

export async function getFundraisingSignalRows(limit = 6) {
  await ensureFundraisingLiveTable();

  const result = await pool.query(
    `
      with ranked as (
        select
          row_number() over (
            order by
              coalesce(receipts, 0) desc,
              coalesce(cash_on_hand, 0) desc,
              coalesce(name, '') asc
          ) as rank,
          candidate_id,
          name,
          state,
          office,
          party,
          coalesce(receipts, 0) as receipts,
          coalesce(cash_on_hand, 0) as cash_on_hand
        from fundraising_live
      )
      select *
      from ranked
      order by rank asc
      limit $1
    `,
    [limit]
  );

  return result.rows || [];
}

export async function rebuildExecutiveFeedEvents() {
  await ensureExecutiveFeedEventsTable();
  await ensureFundraisingLiveTable();

  const battlegrounds = await getBattlegroundSignalRows(8);
  const fundraising = await getFundraisingSignalRows(6);

  await pool.query(`DELETE FROM executive_feed_events`);

  let inserted = 0;

  for (const row of battlegrounds.slice(0, 4)) {
    await pool.query(
      `
        INSERT INTO executive_feed_events (
          event_type,
          severity,
          title,
          source,
          state,
          office,
          risk,
          candidate_name,
          candidate_id,
          metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      `,
      [
        "battleground.priority",
        row.priority === "Tier 1" ? "High" : "Medium",
        `${row.race} remains live on the board`,
        "Battleground Engine",
        row.state,
        row.office,
        row.risk,
        row.candidate,
        row.external_id,
        JSON.stringify({
          race: row.race,
          probability: row.probability,
          momentum: row.momentum,
          priority: row.priority,
          receipts: row.receipts,
          vendor_count: row.vendor_count
        })
      ]
    );
    inserted += 1;
  }

  for (const [index, row] of fundraising.slice(0, 3).entries()) {
    await pool.query(
      `
        INSERT INTO executive_feed_events (
          event_type,
          severity,
          title,
          source,
          state,
          office,
          risk,
          candidate_name,
          candidate_id,
          metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      `,
      [
        "fundraising.signal",
        index === 0 ? "High" : "Medium",
        `${row.name} is a top fundraising leader`,
        "Fundraising Intelligence",
        normalizeStateName(row.state),
        row.office,
        index === 0 ? "Watch" : "Monitor",
        row.name,
        row.candidate_id,
        JSON.stringify({
          rank: row.rank,
          receipts: Number(row.receipts || 0),
          cash_on_hand: Number(row.cash_on_hand || 0),
          party: row.party || ""
        })
      ]
    );
    inserted += 1;
  }

  const vendorGapRows = battlegrounds
    .filter((row) => Number(row.vendor_count || 0) < 2)
    .slice(0, 3);

  for (const row of vendorGapRows) {
    await pool.query(
      `
        INSERT INTO executive_feed_events (
          event_type,
          severity,
          title,
          source,
          state,
          office,
          risk,
          candidate_name,
          candidate_id,
          metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      `,
      [
        "vendor.coverage_gap",
        "High",
        `${row.race} has thin vendor coverage`,
        "Vendor Intelligence",
        row.state,
        row.office,
        "Elevated",
        row.candidate,
        row.external_id,
        JSON.stringify({
          vendor_count: row.vendor_count,
          receipts: row.receipts,
          recommendation: "Expand in-state vendor bench"
        })
      ]
    );
    inserted += 1;
  }

  return {
    success: true,
    inserted
  };
}

export async function getExecutiveFeedEvents(limit = 6) {
  await ensureExecutiveFeedEventsTable();

  const result = await pool.query(
    `
      select
        id,
        event_type,
        severity,
        title,
        source,
        state,
        office,
        risk,
        candidate_name,
        candidate_id,
        vendor_id,
        metadata,
        created_at
      from executive_feed_events
      order by created_at desc, id desc
      limit $1
    `,
    [limit]
  );

  return (result.rows || []).map((row) => ({
    id: row.id,
    time: row.created_at ? new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Now",
    title: row.title,
    source: row.source,
    severity: row.severity,
    type: row.event_type,
    state: row.state,
    office: row.office,
    risk: row.risk,
    candidate_name: row.candidate_name,
    candidate_id: row.candidate_id,
    vendor_id: row.vendor_id,
    metadata: row.metadata || {},
    created_at: row.created_at
  }));
}

export async function runLiveIntelligenceRefresh() {
  await ensureExecutiveFeedEventsTable();
  await ensureFundraisingLiveTable();

  const feedResult = await rebuildExecutiveFeedEvents();

  return {
    success: true,
    fundraising_refreshed: true,
    executive_feed: feedResult
  };
}
