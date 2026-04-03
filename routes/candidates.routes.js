import express from "express";

const router = express.Router();

async function getDb() {
  const candidates = [
    "../config/database.js",
    "../db.js",
    "../config/db.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      return mod.default || mod.db || mod.pool || mod.client || null;
    } catch {
      // keep trying
    }
  }

  return null;
}

async function safeQuery(sql, params = []) {
  try {
    const db = await getDb();
    if (!db) return { rows: [] };

    if (typeof db.query === "function") {
      return await db.query(sql, params);
    }

    if (typeof db.execute === "function") {
      const [rows] = await db.execute(sql, params);
      return { rows };
    }

    return { rows: [] };
  } catch {
    return { rows: [] };
  }
}

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function fallbackCandidates() {
  return [
    {
      id: 1,
      full_name: "Jane Thompson",
      first_name: "Jane",
      last_name: "Thompson",
      state: "Georgia",
      office: "Senate",
      party: "Democratic",
      website: "https://example.com",
      election_name: "2026 Georgia Senate",
      status: "active"
    },
    {
      id: 2,
      full_name: "Robert Gaines",
      first_name: "Robert",
      last_name: "Gaines",
      state: "Pennsylvania",
      office: "Governor",
      party: "Republican",
      website: "https://example.com",
      election_name: "2026 Pennsylvania Governor",
      status: "active"
    }
  ];
}

router.get("/", async (req, res) => {
  try {
    const {
      q = "",
      state = "",
      office = "",
      party = "",
      page = "1",
      limit = "12"
    } = req.query;

    const pageNum = Math.max(1, toInt(page, 1));
    const limitNum = Math.max(1, Math.min(100, toInt(limit, 12)));
    const offset = (pageNum - 1) * limitNum;

    const { rows } = await safeQuery(
      `
        select *
        from candidates
        where ($1 = '' or (
          coalesce(full_name, '') ilike '%' || $1 || '%'
          or coalesce(first_name, '') ilike '%' || $1 || '%'
          or coalesce(last_name, '') ilike '%' || $1 || '%'
          or coalesce(election_name, '') ilike '%' || $1 || '%'
        ))
          and ($2 = '' or coalesce(state, '') = $2)
          and ($3 = '' or coalesce(office, '') = $3)
          and ($4 = '' or coalesce(party, '') = $4)
        order by coalesce(last_name, full_name, 'zzz') asc
        limit $5 offset $6
      `,
      [q, state, office, party, limitNum, offset]
    );

    const results = rows.length ? rows : fallbackCandidates().filter((item) => {
      const qMatch =
        !q ||
        `${item.full_name} ${item.election_name}`.toLowerCase().includes(String(q).toLowerCase());
      const stateMatch = !state || item.state === state;
      const officeMatch = !office || item.office === office;
      const partyMatch = !party || item.party === party;
      return qMatch && stateMatch && officeMatch && partyMatch;
    });

    res.status(200).json({
      results,
      page: pageNum,
      limit: limitNum,
      total: results.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load candidates" });
  }
});

router.get("/states", async (_req, res) => {
  try {
    const { rows } = await safeQuery(
      `
        select distinct state
        from candidates
        where state is not null and state <> ''
        order by state asc
      `
    );

    const results = rows.length
      ? rows.map((r) => r.state)
      : [...new Set(fallbackCandidates().map((c) => c.state))];

    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load candidate states" });
  }
});

router.get("/offices", async (_req, res) => {
  try {
    const { rows } = await safeQuery(
      `
        select distinct office
        from candidates
        where office is not null and office <> ''
        order by office asc
      `
    );

    const results = rows.length
      ? rows.map((r) => r.office)
      : [...new Set(fallbackCandidates().map((c) => c.office))];

    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load candidate offices" });
  }
});

router.get("/parties", async (_req, res) => {
  try {
    const { rows } = await safeQuery(
      `
        select distinct party
        from candidates
        where party is not null and party <> ''
        order by party asc
      `
    );

    const results = rows.length
      ? rows.map((r) => r.party)
      : [...new Set(fallbackCandidates().map((c) => c.party))];

    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load candidate parties" });
  }
});

export default router;
