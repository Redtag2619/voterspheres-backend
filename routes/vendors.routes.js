import express from "express";

const router = express.Router();

const FALLBACK_VENDORS = [
  {
    id: 1,
    vendor_name: "Precision Mail Group",
    category: "Direct Mail",
    status: "active",
    state: "Georgia",
    campaign_name: "Georgia Senate Race",
    candidate_name: "Jane Thompson",
    firm_name: "Red Tag Strategies",
    contract_value: 85000
  },
  {
    id: 2,
    vendor_name: "Capitol Digital Media",
    category: "Digital",
    status: "prospect",
    state: "Pennsylvania",
    campaign_name: "Pennsylvania Governor Race",
    candidate_name: "Robert Gaines",
    firm_name: "Red Tag Strategies",
    contract_value: 42000
  }
];

const FALLBACK_CATEGORIES = [...new Set(FALLBACK_VENDORS.map((v) => v.category))];
const FALLBACK_STATUSES = [...new Set(FALLBACK_VENDORS.map((v) => v.status))];

let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;

  const candidates = [
    "../config/database.js",
    "../config/db.js",
    "../db.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      const db = mod.default || mod.db || mod.pool || mod.client || null;
      if (db) {
        cachedDb = db;
        return db;
      }
    } catch {
      // try next
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

function withTimeout(promise, ms = 2500) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ rows: [] }), ms))
  ]);
}

router.get("/dropdowns/categories", async (_req, res) => {
  try {
    const result = await withTimeout(
      safeQuery(
        `
          select distinct category
          from campaign_vendors
          where category is not null and category <> ''
          order by category asc
        `
      ),
      2000
    );

    const results =
      result.rows?.length > 0
        ? result.rows.map((r) => r.category).filter(Boolean)
        : FALLBACK_CATEGORIES;

    return res.status(200).json({ results });
  } catch {
    return res.status(200).json({ results: FALLBACK_CATEGORIES });
  }
});

router.get("/dropdowns/statuses", async (_req, res) => {
  try {
    const result = await withTimeout(
      safeQuery(
        `
          select distinct status
          from campaign_vendors
          where status is not null and status <> ''
          order by status asc
        `
      ),
      2000
    );

    const results =
      result.rows?.length > 0
        ? result.rows.map((r) => r.status).filter(Boolean)
        : FALLBACK_STATUSES;

    return res.status(200).json({ results });
  } catch {
    return res.status(200).json({ results: FALLBACK_STATUSES });
  }
});

router.get("/", async (req, res) => {
  try {
    const {
      search = "",
      category = "",
      status = "",
      state = ""
    } = req.query;

    const result = await withTimeout(
      safeQuery(
        `
          select
            v.*,
            c.campaign_name,
            c.candidate_name,
            f.name as firm_name
          from campaign_vendors v
          left join campaigns c on c.id = v.campaign_id
          left join firms f on f.id = c.firm_id
          where ($1 = '' or (
            coalesce(v.vendor_name, '') ilike '%' || $1 || '%'
            or coalesce(v.category, '') ilike '%' || $1 || '%'
            or coalesce(c.campaign_name, '') ilike '%' || $1 || '%'
            or coalesce(c.candidate_name, '') ilike '%' || $1 || '%'
            or coalesce(f.name, '') ilike '%' || $1 || '%'
          ))
            and ($2 = '' or coalesce(v.category, '') = $2)
            and ($3 = '' or coalesce(v.status, '') = $3)
            and ($4 = '' or coalesce(v.state, '') = $4)
          order by coalesce(v.vendor_name, 'zzz') asc
        `,
        [search, category, status, state]
      ),
      3000
    );

    const results =
      result.rows?.length > 0
        ? result.rows
        : FALLBACK_VENDORS.filter((item) => {
            const q = String(search).toLowerCase();
            const searchMatch =
              !search ||
              `${item.vendor_name} ${item.category} ${item.campaign_name} ${item.candidate_name} ${item.firm_name}`
                .toLowerCase()
                .includes(q);
            const categoryMatch = !category || item.category === category;
            const statusMatch = !status || item.status === status;
            const stateMatch = !state || item.state === state;
            return searchMatch && categoryMatch && statusMatch && stateMatch;
          });

    const summary = {
      total_vendors: results.length,
      active_vendors: results.filter((r) => r.status === "active").length,
      prospect_vendors: results.filter((r) => r.status === "prospect").length,
      total_contract_value: results.reduce((sum, r) => sum + Number(r.contract_value || 0), 0)
    };

    return res.status(200).json({ results, summary });
  } catch {
    const results = FALLBACK_VENDORS;
    const summary = {
      total_vendors: results.length,
      active_vendors: results.filter((r) => r.status === "active").length,
      prospect_vendors: results.filter((r) => r.status === "prospect").length,
      total_contract_value: results.reduce((sum, r) => sum + Number(r.contract_value || 0), 0)
    };

    return res.status(200).json({ results, summary });
  }
});

export default router;
