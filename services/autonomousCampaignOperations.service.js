import { pool } from "../db/pool.js";

function n(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function pct(value) {
  return Math.round(n(value));
}

export async function ensureAutonomousCampaignOperationsSchema(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS autonomous_operations_plans (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      plan_type TEXT DEFAULT 'autonomous_campaign_operations',
      geographic_scope TEXT DEFAULT 'National Coverage',
      state_code TEXT,
      state_name TEXT,
      status TEXT DEFAULT 'pending_approval',
      priority TEXT DEFAULT 'medium',
      confidence_percentage NUMERIC DEFAULT 78,
      impact_percentage NUMERIC DEFAULT 74,
      risk_percentage NUMERIC DEFAULT 32,
      automation_readiness_percentage NUMERIC DEFAULT 70,
      executive_summary TEXT,
      recommendation TEXT,
      source_modules TEXT[] DEFAULT ARRAY[]::TEXT[],
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS autonomous_operations_tasks (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      plan_id INTEGER REFERENCES autonomous_operations_plans(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      owner TEXT DEFAULT 'Executive Operations',
      status TEXT DEFAULT 'queued',
      priority TEXT DEFAULT 'medium',
      due_window TEXT DEFAULT '72 hours',
      automation_level TEXT DEFAULT 'recommendation_only',
      command_center_ready BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS autonomous_operations_alerts (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT DEFAULT 'medium',
      trigger_source TEXT DEFAULT 'Autonomous Campaign Operations',
      state_code TEXT,
      state_name TEXT,
      recommended_response TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS autonomous_operations_playbooks (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      playbook_type TEXT DEFAULT 'campaign_response',
      description TEXT,
      activation_condition TEXT,
      execution_steps JSONB DEFAULT '[]'::jsonb,
      risk_controls JSONB DEFAULT '[]'::jsonb,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_autonomous_operations_plans_workspace ON autonomous_operations_plans(workspace_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_autonomous_operations_tasks_workspace ON autonomous_operations_tasks(workspace_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_autonomous_operations_alerts_workspace ON autonomous_operations_alerts(workspace_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_autonomous_operations_playbooks_workspace ON autonomous_operations_playbooks(workspace_id);`);
}

function normalizePlan(plan, tasks = []) {
  return {
    ...plan,
    confidence_percentage: pct(plan.confidence_percentage),
    impact_percentage: pct(plan.impact_percentage),
    risk_percentage: pct(plan.risk_percentage),
    automation_readiness_percentage: pct(plan.automation_readiness_percentage),
    tasks,
  };
}

function fallbackData(workspaceId = 1) {
  return {
    summary: {
      activeOperationPlans: 3,
      queuedAutonomousTasks: 8,
      highPriorityAlerts: 2,
      averageAutomationReadinessPercentage: 76,
      averageOperationalImpactPercentage: 82,
      averageExecutionRiskPercentage: 31,
    },
    plans: [
      {
        id: "fallback-plan-1",
        workspace_id: workspaceId,
        title: "Battleground Field Acceleration Plan",
        plan_type: "autonomous_campaign_operations",
        geographic_scope: "Georgia",
        state_code: "GA",
        state_name: "Georgia",
        status: "pending_approval",
        priority: "high",
        confidence_percentage: 88,
        impact_percentage: 86,
        risk_percentage: 29,
        automation_readiness_percentage: 82,
        executive_summary:
          "Autonomous operations detected a high-value field acceleration opportunity in Georgia.",
        recommendation:
          "Approve queued field, vendor, coalition, and Command Center actions for priority county execution.",
        source_modules: [
          "National Political Digital Twin",
          "Predictive Campaign Simulation",
          "Executive Decision Intelligence",
          "Executive Operations Center",
        ],
        tasks: [
          {
            id: "fallback-task-1",
            title: "Create priority county field deployment queue",
            description: "Generate county-level field deployment tasks for executive review.",
            owner: "Executive Operations",
            status: "queued",
            priority: "high",
            due_window: "24 hours",
            automation_level: "executive_approval_required",
            command_center_ready: true,
          },
        ],
      },
    ],
    alerts: [
      {
        id: "fallback-alert-1",
        title: "Autonomous risk trigger detected",
        description: "Vendor readiness and coalition instability require executive review before expansion.",
        severity: "high",
        trigger_source: "National Political Digital Twin",
        state_name: "Arizona",
        recommended_response: "Run vendor readiness review before converting simulation tasks.",
      },
    ],
    playbooks: [
      {
        id: "fallback-playbook-1",
        title: "Battleground Acceleration Playbook",
        playbook_type: "field_acceleration",
        description: "Converts forecast and simulation opportunities into field and vendor execution tasks.",
        activation_condition: "Win probability movement above three percentage points with execution readiness above seventy-five percent.",
        execution_steps: [
          "Confirm forecast confidence",
          "Validate vendor readiness",
          "Create Command Center task queue",
          "Assign executive owner",
        ],
        risk_controls: [
          "Require executive approval before activation",
          "Validate state operations capacity",
          "Monitor coalition backlash risk",
        ],
        status: "active",
      },
    ],
  };
}

export async function seedAutonomousCampaignOperations(workspaceId = 1) {
  await ensureAutonomousCampaignOperationsSchema(pool);

  const existing = await pool.query(
    `SELECT id FROM autonomous_operations_plans WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );

  if (existing.rows.length) {
    return { seeded: false, reason: "existing-data" };
  }

  const created = await pool.query(
    `
    INSERT INTO autonomous_operations_plans
    (
      workspace_id,
      title,
      plan_type,
      geographic_scope,
      state_code,
      state_name,
      status,
      priority,
      confidence_percentage,
      impact_percentage,
      risk_percentage,
      automation_readiness_percentage,
      executive_summary,
      recommendation,
      source_modules
    )
    VALUES
    ($1, 'Battleground Field Acceleration Plan', 'field_acceleration', 'Georgia', 'GA', 'Georgia', 'pending_approval', 'high', 88, 86, 29, 82,
     'Autonomous operations detected a high-value field acceleration opportunity in Georgia.',
     'Approve queued field, vendor, coalition, and Command Center actions for priority county execution.',
     ARRAY['National Political Digital Twin','Predictive Campaign Simulation','Executive Decision Intelligence','Executive Operations Center']),
    ($1, 'Coalition Stability Response Plan', 'coalition_response', 'Pennsylvania', 'PA', 'Pennsylvania', 'pending_approval', 'high', 84, 81, 34, 78,
     'Coalition volatility requires a coordinated response across messaging, field, and executive monitoring.',
     'Create a coalition response queue and assign executive owners to persuasion-sensitive voter blocs.',
     ARRAY['National Coalition Intelligence','Executive Decision Intelligence','National Political Digital Twin']),
    ($1, 'Vendor Readiness Recovery Plan', 'vendor_recovery', 'Arizona', 'AZ', 'Arizona', 'monitoring', 'medium', 79, 73, 42, 69,
     'Vendor readiness is below preferred threshold for simulated expansion.',
     'Stabilize vendor capacity before converting simulation output into full operational execution.',
     ARRAY['Vendor Intelligence Network','Predictive Campaign Simulation','Executive Operations Center'])
    RETURNING id, title
    `,
    [workspaceId]
  );

  const firstId = created.rows[0]?.id;
  const secondId = created.rows[1]?.id;
  const thirdId = created.rows[2]?.id;

  if (firstId) {
    await pool.query(
      `
      INSERT INTO autonomous_operations_tasks
      (workspace_id, plan_id, title, description, owner, status, priority, due_window, automation_level, command_center_ready)
      VALUES
      ($1, $2, 'Create priority county field deployment queue', 'Generate county-level field deployment tasks for executive review.', 'Executive Operations', 'queued', 'high', '24 hours', 'executive_approval_required', TRUE),
      ($1, $2, 'Validate vendor coverage for priority counties', 'Confirm vendor capacity before expanding execution.', 'Vendor Operations', 'queued', 'high', '48 hours', 'executive_approval_required', TRUE),
      ($1, $2, 'Assign coalition monitoring owner', 'Assign a coalition owner for priority persuasion groups.', 'Coalition Director', 'queued', 'medium', '72 hours', 'recommendation_only', TRUE)
      `,
      [workspaceId, firstId]
    );
  }

  if (secondId) {
    await pool.query(
      `
      INSERT INTO autonomous_operations_tasks
      (workspace_id, plan_id, title, description, owner, status, priority, due_window, automation_level, command_center_ready)
      VALUES
      ($1, $2, 'Generate coalition response task queue', 'Convert coalition volatility signal into campaign response tasks.', 'Coalition Director', 'queued', 'high', '24 hours', 'executive_approval_required', TRUE),
      ($1, $2, 'Prepare message testing request', 'Create a messaging experiment tied to coalition movement.', 'Strategy Team', 'queued', 'medium', '72 hours', 'recommendation_only', TRUE)
      `,
      [workspaceId, secondId]
    );
  }

  if (thirdId) {
    await pool.query(
      `
      INSERT INTO autonomous_operations_tasks
      (workspace_id, plan_id, title, description, owner, status, priority, due_window, automation_level, command_center_ready)
      VALUES
      ($1, $2, 'Audit vendor readiness gap', 'Identify specific vendor execution constraints before activation.', 'Vendor Operations', 'queued', 'medium', '48 hours', 'recommendation_only', TRUE),
      ($1, $2, 'Hold simulation conversion pending capacity review', 'Pause automated simulation conversion until vendor readiness improves.', 'Executive Operations', 'queued', 'medium', '24 hours', 'executive_approval_required', FALSE)
      `,
      [workspaceId, thirdId]
    );
  }

  await pool.query(
    `
    INSERT INTO autonomous_operations_alerts
    (workspace_id, title, description, severity, trigger_source, state_code, state_name, recommended_response)
    VALUES
    ($1, 'Autonomous battleground acceleration trigger', 'Digital twin and simulation layers indicate a field acceleration opportunity.', 'high', 'National Political Digital Twin', 'GA', 'Georgia', 'Approve field acceleration plan after vendor readiness validation.'),
    ($1, 'Coalition volatility response trigger', 'Coalition instability crossed the executive monitoring threshold.', 'high', 'National Coalition Intelligence', 'PA', 'Pennsylvania', 'Activate coalition stability response playbook.'),
    ($1, 'Vendor readiness constraint trigger', 'Vendor capacity is below threshold for autonomous execution conversion.', 'medium', 'Vendor Intelligence Network', 'AZ', 'Arizona', 'Review vendor recovery plan before automated task conversion.')
    `,
    [workspaceId]
  );

  await pool.query(
    `
    INSERT INTO autonomous_operations_playbooks
    (workspace_id, title, playbook_type, description, activation_condition, execution_steps, risk_controls, status)
    VALUES
    ($1, 'Battleground Acceleration Playbook', 'field_acceleration', 'Converts forecast and simulation opportunities into field, vendor, and Command Center execution tasks.', 'Win probability movement above three percentage points with execution readiness above seventy-five percent.', '["Confirm forecast confidence","Validate vendor readiness","Create Command Center task queue","Assign executive owner"]'::jsonb, '["Require executive approval before activation","Validate state operations capacity","Monitor coalition backlash risk"]'::jsonb, 'active'),
    ($1, 'Coalition Stability Response Playbook', 'coalition_response', 'Creates response tasks when coalition movement exceeds executive monitoring threshold.', 'Coalition movement declines while persuasion opportunity remains active.', '["Identify affected coalition","Assign coalition owner","Create message testing task","Monitor response movement"]'::jsonb, '["Avoid over-automation of sensitive voter contact","Require strategy review before public messaging"]'::jsonb, 'active'),
    ($1, 'Vendor Recovery Playbook', 'vendor_recovery', 'Stabilizes execution capacity before converting strategic plans into operational tasks.', 'Vendor readiness falls below enterprise threshold.', '["Audit vendor coverage","Identify replacement capacity","Escalate procurement options","Hold automated execution until readiness improves"]'::jsonb, '["Require human review before vendor replacement","Prevent automatic spend commitments"]'::jsonb, 'active')
    `,
    [workspaceId]
  );

  return { seeded: true, plans: created.rows.length };
}

export async function getAutonomousCampaignOperations(workspaceId = 1) {
  try {
    await ensureAutonomousCampaignOperationsSchema(pool);

    const existing = await pool.query(
      `SELECT id FROM autonomous_operations_plans WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    );

    if (!existing.rows.length) {
      await seedAutonomousCampaignOperations(workspaceId);
    }

    const [plansResult, tasksResult, alertsResult, playbooksResult] = await Promise.all([
      pool.query(
        `
        SELECT *
        FROM autonomous_operations_plans
        WHERE workspace_id = $1
        ORDER BY priority DESC, impact_percentage DESC, automation_readiness_percentage DESC, created_at DESC
        LIMIT 30
        `,
        [workspaceId]
      ),
      pool.query(
        `
        SELECT *
        FROM autonomous_operations_tasks
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        LIMIT 100
        `,
        [workspaceId]
      ),
      pool.query(
        `
        SELECT *
        FROM autonomous_operations_alerts
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        LIMIT 30
        `,
        [workspaceId]
      ),
      pool.query(
        `
        SELECT *
        FROM autonomous_operations_playbooks
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        LIMIT 30
        `,
        [workspaceId]
      ),
    ]);

    const plans = plansResult.rows.map((plan) => {
      const tasks = tasksResult.rows.filter((task) => Number(task.plan_id) === Number(plan.id));
      return normalizePlan(plan, tasks);
    });

    const summary = {
      activeOperationPlans: plans.length,
      queuedAutonomousTasks: tasksResult.rows.filter((task) => String(task.status || "").toLowerCase() === "queued").length,
      highPriorityAlerts: alertsResult.rows.filter((alert) => String(alert.severity || "").toLowerCase() === "high").length,
      averageAutomationReadinessPercentage: Math.round(
        plans.reduce((sum, item) => sum + n(item.automation_readiness_percentage), 0) / Math.max(plans.length, 1)
      ),
      averageOperationalImpactPercentage: Math.round(
        plans.reduce((sum, item) => sum + n(item.impact_percentage), 0) / Math.max(plans.length, 1)
      ),
      averageExecutionRiskPercentage: Math.round(
        plans.reduce((sum, item) => sum + n(item.risk_percentage), 0) / Math.max(plans.length, 1)
      ),
    };

    return {
      summary,
      plans,
      alerts: alertsResult.rows,
      playbooks: playbooksResult.rows,
    };
  } catch (error) {
    console.error("[Autonomous Campaign Operations] service fallback:", error);
    return fallbackData(workspaceId);
  }
}

export async function generateAutonomousOperationPlan(workspaceId = 1, payload = {}) {
  await ensureAutonomousCampaignOperationsSchema(pool);

  const result = await pool.query(
    `
    INSERT INTO autonomous_operations_plans
    (
      workspace_id,
      title,
      plan_type,
      geographic_scope,
      state_code,
      state_name,
      status,
      priority,
      confidence_percentage,
      impact_percentage,
      risk_percentage,
      automation_readiness_percentage,
      executive_summary,
      recommendation,
      source_modules,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,'pending_approval',$7,$8,$9,$10,$11,$12,$13,$14,NOW())
    RETURNING *
    `,
    [
      workspaceId,
      payload.title || "Autonomous Executive Operations Plan",
      payload.plan_type || "autonomous_campaign_operations",
      payload.geographic_scope || payload.state_name || "National Coverage",
      payload.state_code || null,
      payload.state_name || payload.geographic_scope || "National Coverage",
      payload.priority || "medium",
      n(payload.confidence_percentage, 82),
      n(payload.impact_percentage, 78),
      n(payload.risk_percentage, 34),
      n(payload.automation_readiness_percentage, 76),
      payload.executive_summary || "Autonomous operations generated a new executive-ready operations plan.",
      payload.recommendation || "Review the plan and approve Command Center task conversion when ready.",
      payload.source_modules || ["Autonomous Campaign Operations", "National Political Digital Twin"],
    ]
  );

  return {
    ok: true,
    plan: normalizePlan(result.rows[0], []),
  };
}

export async function getAutonomousCampaignOperationsHealth() {
  await ensureAutonomousCampaignOperationsSchema(pool);

  const result = await pool.query(`
    SELECT COUNT(*)::int AS plan_count, MAX(updated_at) AS last_updated
    FROM autonomous_operations_plans
  `);

  return {
    ok: true,
    service: "autonomous-campaign-operations",
    plan_count: result.rows[0]?.plan_count || 0,
    last_updated: result.rows[0]?.last_updated || null,
    timestamp: new Date().toISOString(),
  };
}
