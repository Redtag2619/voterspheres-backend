import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function clean(value = "") {
  return String(value || "").trim();
}

async function ensureLaunchAssetTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS launch_assets (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      asset_key TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      owner TEXT,
      content TEXT,
      notes TEXT,
      route TEXT,
      priority TEXT DEFAULT 'medium',
      due_date DATE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(firm_id, asset_key)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_launch_assets_firm_id
    ON launch_assets(firm_id)
  `);
}

const DEFAULT_ASSETS = [
  {
    asset_key: "landing_page_copy",
    title: "Landing Page Copy",
    category: "Website",
    status: "review",
    priority: "high",
    route: "/",
    content:
      "VoterSpheres is the political operating system for consultants, campaign teams, vendors, and serious political operators.",
    notes: "Confirm hero copy, product positioning, CTA, pricing links, and beta access language.",
  },
  {
    asset_key: "pricing_page",
    title: "Pricing Page",
    category: "Revenue",
    status: "review",
    priority: "high",
    route: "/pricing",
    content:
      "Starter, Pro, and Enterprise pricing should clearly map to workspace, intelligence, reports, and consultant operations value.",
    notes: "Verify Stripe checkout links and plan gating.",
  },
  {
    asset_key: "demo_script",
    title: "Demo Script",
    category: "Sales",
    status: "draft",
    priority: "high",
    route: "/executive-workspace",
    content:
      "Start at Executive Workspace. Show Launch Readiness, National Command, Opportunity Engine, Revenue Pipeline, Reports, and AI Co-Pilot.",
    notes: "Create a 7-minute founder-led demo path.",
  },
  {
    asset_key: "sales_one_pager",
    title: "Sales One-Pager",
    category: "Sales",
    status: "draft",
    priority: "medium",
    route: "/launch-assets",
    content:
      "Position VoterSpheres as command infrastructure for political consultants: intelligence, workflow, revenue, and execution in one platform.",
    notes: "Use for outreach to political firms and vendors.",
  },
  {
    asset_key: "beta_invite_copy",
    title: "Beta Invite Copy",
    category: "Growth",
    status: "draft",
    priority: "medium",
    route: "/admin/beta-access",
    content:
      "You are invited to the private VoterSpheres beta for political consultants and campaign operators.",
    notes: "Prepare short email and LinkedIn DM version.",
  },
  {
    asset_key: "customer_onboarding",
    title: "Customer Onboarding Checklist",
    category: "Onboarding",
    status: "review",
    priority: "high",
    route: "/executive-workspace",
    content:
      "Create workspace, import contacts, review Opportunity Engine, configure reports, verify alerts, and invite team members.",
    notes: "Make this the first-run experience after signup.",
  },
  {
    asset_key: "product_tour",
    title: "Product Tour Checklist",
    category: "Onboarding",
    status: "draft",
    priority: "medium",
    route: "/executive-workspace",
    content:
      "Tour: Executive Workspace, Universal Search, Opportunity Engine, Revenue Pipeline, Political Graph, Reports, Notifications.",
    notes: "Can become in-app walkthrough later.",
  },
  {
    asset_key: "launch_checklist",
    title: "Launch Checklist",
    category: "Launch",
    status: "review",
    priority: "high",
    route: "/launch-readiness",
    content:
      "Confirm launch readiness score, QA pass rate, production hardening, database stability, Stripe billing, demo workspace, and support contact.",
    notes: "Must be complete before public launch.",
  },
];

async function seedDefaults(firmId) {
  for (const asset of DEFAULT_ASSETS) {
    await pool.query(
      `
        INSERT INTO launch_assets (
          firm_id,
          asset_key,
          title,
          category,
          status,
          owner,
          content,
          notes,
          route,
          priority,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
        ON CONFLICT (firm_id, asset_key)
        DO NOTHING
      `,
      [
        firmId,
        asset.asset_key,
        asset.title,
        asset.category,
        asset.status,
        "Founder",
        asset.content,
        asset.notes,
        asset.route,
        asset.priority,
      ]
    );
  }
}

function normalizeStatus(value = "") {
  const v = String(value || "").toLowerCase();
  if (["draft", "review", "ready", "published", "blocked"].includes(v)) return v;
  return "draft";
}

function normalizePriority(value = "") {
  const v = String(value || "").toLowerCase();
  if (["low", "medium", "high", "critical"].includes(v)) return v;
  return "medium";
}

export async function getLaunchAssets({ user = {}, category = "", status = "", q = "" }) {
  await ensureLaunchAssetTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  await seedDefaults(firmId);

  const filters = ["firm_id = $1"];
  const params = [firmId];
  let index = 2;

  if (category) {
    filters.push(`category ILIKE $${index}`);
    params.push(`%${category}%`);
    index += 1;
  }

  if (status) {
    filters.push(`status = $${index}`);
    params.push(normalizeStatus(status));
    index += 1;
  }

  if (q) {
    filters.push(`(
      title ILIKE $${index}
      OR category ILIKE $${index}
      OR COALESCE(content,'') ILIKE $${index}
      OR COALESCE(notes,'') ILIKE $${index}
      OR COALESCE(owner,'') ILIKE $${index}
    )`);
    params.push(`%${q}%`);
    index += 1;
  }

  const rows = await pool.query(
    `
      SELECT *
      FROM launch_assets
      WHERE ${filters.join(" AND ")}
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END,
        CASE status
          WHEN 'blocked' THEN 1
          WHEN 'draft' THEN 2
          WHEN 'review' THEN 3
          WHEN 'ready' THEN 4
          WHEN 'published' THEN 5
          ELSE 6
        END,
        updated_at DESC
    `,
    params
  );

  const assets = rows.rows || [];

  const categories = [...new Set(assets.map((item) => item.category).filter(Boolean))].sort();

  const summary = {
    total: assets.length,
    draft: assets.filter((item) => item.status === "draft").length,
    review: assets.filter((item) => item.status === "review").length,
    ready: assets.filter((item) => item.status === "ready").length,
    published: assets.filter((item) => item.status === "published").length,
    blocked: assets.filter((item) => item.status === "blocked").length,
    high_priority: assets.filter((item) => ["high", "critical"].includes(item.priority)).length,
    readiness_score: assets.length
      ? Math.round(
          ((assets.filter((item) => ["ready", "published"].includes(item.status)).length) /
            assets.length) *
            100
        )
      : 0,
  };

  return {
    summary,
    categories,
    assets,
    filters: { category, status, q },
    updated_at: new Date().toISOString(),
  };
}

export async function upsertLaunchAsset({ user = {}, payload = {} }) {
  await ensureLaunchAssetTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const title = clean(payload.title);
  if (!title) throw new Error("Asset title is required.");

  const assetKey =
    clean(payload.asset_key) ||
    title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  const result = await pool.query(
    `
      INSERT INTO launch_assets (
        firm_id,
        asset_key,
        title,
        category,
        status,
        owner,
        content,
        notes,
        route,
        priority,
        due_date,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
      ON CONFLICT (firm_id, asset_key)
      DO UPDATE SET
        title = EXCLUDED.title,
        category = EXCLUDED.category,
        status = EXCLUDED.status,
        owner = EXCLUDED.owner,
        content = EXCLUDED.content,
        notes = EXCLUDED.notes,
        route = EXCLUDED.route,
        priority = EXCLUDED.priority,
        due_date = EXCLUDED.due_date,
        updated_at = NOW()
      RETURNING *
    `,
    [
      firmId,
      assetKey,
      title,
      clean(payload.category || "Launch"),
      normalizeStatus(payload.status),
      clean(payload.owner || "Founder"),
      clean(payload.content),
      clean(payload.notes),
      clean(payload.route),
      normalizePriority(payload.priority),
      payload.due_date || null,
    ]
  );

  return {
    asset: result.rows[0],
    message: "Launch asset saved.",
  };
}

export async function updateLaunchAssetStatus({ user = {}, id, status = "" }) {
  await ensureLaunchAssetTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const result = await pool.query(
    `
      UPDATE launch_assets
      SET status = $1, updated_at = NOW()
      WHERE id = $2 AND firm_id = $3
      RETURNING *
    `,
    [normalizeStatus(status), id, firmId]
  );

  if (!result.rows[0]) throw new Error("Launch asset not found.");

  return {
    asset: result.rows[0],
    message: "Launch asset status updated.",
  };
}

export async function deleteLaunchAsset({ user = {}, id }) {
  await ensureLaunchAssetTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  await pool.query(
    `
      DELETE FROM launch_assets
      WHERE id = $1 AND firm_id = $2
    `,
    [id, firmId]
  );

  return { message: "Launch asset deleted." };
}
