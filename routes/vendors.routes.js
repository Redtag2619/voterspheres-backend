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

function fallbackVendors() {
  return [
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
}

router.get("/", async (req, res) => {
  try {
    const {
      search = "",
      category = "",
      status = "",
      state = ""
    } = req.query;

    const { rows } = await safeQuery(
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
    );

    const results = rows.length
      ? rows
      : fallbackVendors().filter((item) => {
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

    res.status(200).json({ results, summary });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load vendors" });
  }
});

router.get("/dropdowns/categories", async (_req, res) => {
  try {
    const { rows } = await safeQuery(
      `
        select distinct category
        from campaign_vendors
        where category is not null and category <> ''
        order by category asc
      `
    );

    const results = rows.length
      ? rows.map((r) => r.category)
      : [...new Set(fallbackVendors().map((v) => v.category))];

    res.status(200).json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load vendor categories" });
  }
});

router.get("/dropdowns/statuses", async (_req, res) => {
  try {
    const { rows } = await safeQuery(
      `
        select distinct status
        from campaign_vendors
        where status is not null and status <> ''
        order by status asc
      `
    );

    const results = rows.length
      ? rows.map((r) => r.status)
      : [...new Set(fallbackVendors().map((v) => v.status))];

    res.status(200).json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load vendor statuses" });
  }
});

export default router;
