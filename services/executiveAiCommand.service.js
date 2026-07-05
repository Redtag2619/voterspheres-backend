import { pool } from "../db/pool.js";

function n(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function pct(value) {
  return Math.round(n(value));
}

export async function ensureExecutiveAiCommandSchema(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS executive_ai_command_briefs (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      command_status TEXT DEFAULT 'active',
      executive_priority TEXT DEFAULT 'high',
      national_readiness_percentage NUMERIC DEFAULT 78,
      win_probability_percentage NUMERIC DEFAULT 54,
      ai_confidence_percentage NUMERIC DEFAULT 86,
      execution_risk_percentage NUMERIC DEFAULT 32,
      autonomous_readiness_percentage NUMERIC DEFAULT 76,
      strategic_summary TEXT,
      recommended_action TEXT,
      source_modules TEXT[] DEFAULT ARRAY[]::TEXT[],
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS executive_ai_command_missions (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      mission_type TEXT DEFAULT 'executive_mission',
      geographic_scope TEXT DEFAULT 'National Coverage',
      state_name TEXT,
      status TEXT DEFAULT 'pending_approval',
      priority TEXT DEFAULT 'medium',
      impact_percentage NUMERIC DEFAULT 75,
      confidence_percentage NUMERIC DEFAULT 80,
      risk_percentage NUMERIC DEFAULT 35,
      mission_summary TEXT,
      approval_status TEXT DEFAULT 'executive_review',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS executive_ai_command_timeline (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      event_title TEXT NOT NULL,
      event_description TEXT,
      event_type TEXT DEFAULT 'command_event',
      source_module TEXT DEFAULT 'Executive AI Command Platform',
      state_name TEXT,
      impact_percentage NUMERIC DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS executive_ai_command_actions (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      mission_id INTEGER REFERENCES executive_ai_command_missions(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      owner TEXT DEFAULT 'Executive Operations',
      status TEXT DEFAULT 'queued',
      approval_required BOOLEAN DEFAULT TRUE,
      due_window TEXT DEFAULT '72 hours',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_executive_ai_command_briefs_workspace ON executive_ai_command_briefs(workspace_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_executive_ai_command_missions_workspace ON executive_ai_command_missions(workspace_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_executive_ai_command_timeline_workspace ON executive_ai_command_timeline(workspace_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_executive_ai_command_actions_workspace ON executive_ai_command_actions(workspace_id);`);
}

function normalizeBrief(row) {
  return {
    ...row,
    national_readiness_percentage: pct(row.national_readiness_percentage),
    win_probability_percentage: pct(row.win_probability_percentage),
    ai_confidence_percentage: pct(row.ai_confidence_percentage),
    execution_risk_percentage: pct(row.execution_risk_percentage),
    autonomous_readiness_percentage: pct(row.autonomous_readiness_percentage),
  };
}

function normalizeMission(row, actions = []) {
  return {
    ...row,
    impact_percentage: pct(row.impact_percentage),
    confidence_percentage: pct(row.confidence_percentage),
    risk_percentage: pct(row.risk_percentage),
    actions,
  };
}

function fallbackData(workspaceId = 1) {
  return {
    summary: {
      activeCommandBriefs: 1,
      activeExecutiveMissions: 3,
      queuedApprovalActions: 7,
      nationalReadinessPercentage: 79,
      aiConfidencePercentage: 87,
      executionRiskPercentage: 31,
    },
    brief: {
      id: "fallback-brief-1",
      workspace_id: workspaceId,
      title: "National Executive AI Command Brief",
      command_status: "active",
      executive_priority: "high",
      national_readiness_percentage: 79,
      win_probability_percentage: 55,
      ai_confidence_percentage: 87,
      execution_risk_percentage: 31,
      autonomous_readiness_percentage: 77,
      strategic_summary:
        "The Executive AI Command Platform is synthesizing decision intelligence, predictive simulation, national digital twin modeling, and autonomous operations into one command layer.",
      recommended_action:
        "Prioritize battleground execution readiness, approve high-confidence autonomous plans, and continue simulation review before major resource movement.",
      source_modules: [
        "Executive Decision Intelligence",
        "Predictive Campaign Simulation",
        "National Political Digital Twin",
        "Autonomous Campaign Operations",
        "Executive Forecast Engine",
        "Command Center",
      ],
    },
    missions: [
      {
        id: "fallback-mission-1",
        title: "Georgia Battleground Execution Mission",
        mission_type: "battleground_execution",
        geographic_scope: "Georgia",
        state_name: "Georgia",
        status: "pending_approval",
        priority: "high",
        impact_percentage: 86,
        confidence_percentage: 88,
        risk_percentage: 29,
        mission_summary:
          "Approve a coordinated field, coalition, and vendor execution package for Georgia.",
        approval_status: "executive_review",
        actions: [
          {
            id: "fallback-action-1",
            title: "Approve Command Center task conversion",
            description: "Convert the Georgia mission package into operational tasks.",
            owner: "Executive Operations",
            status: "queued",
            approval_required: true,
            due_window: "24 hours",
          },
        ],
      },
    ],
    timeline: [
      {
        id: "fallback-event-1",
        event_title: "Executive command brief generated",
        event_description:
          "AI synthesized decision intelligence, predictive simulation, digital twin, and autonomous operations data.",
        event_type: "command_brief",
        source_module: "Executive AI Command Platform",
        state_name: "National Coverage",
        impact_percentage: 12,
      },
    ],
  };
}

export async function seedExecutiveAiCommand(workspaceId = 1) {
  await ensureExecutiveAiCommandSchema(pool);

  const existing = await pool.query(
    `SELECT id FROM executive_ai_command_briefs WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );

  if (existing.rows.length) {
    return { seeded: false, reason: "existing-data" };
  }

  await pool.query(
    `
    INSERT INTO executive_ai_command_briefs
    (
      workspace_id,
      title,
      command_status,
      executive_priority,
      national_readiness_percentage,
      win_probability_percentage,
      ai_confidence_percentage,
      execution_risk_percentage,
      autonomous_readiness_percentage,
      strategic_summary,
      recommended_action,
      source_modules
    )
    VALUES
    (
      $1,
      'National Executive AI Command Brief',
      'active',
      'high',
      79,
      55,
      87,
      31,
      77,
      'The Executive AI Command Platform is synthesizing decision intelligence, predictive simulation, national digital twin modeling, and autonomous operations into one command layer.',
      'Prioritize battleground execution readiness, approve high-confidence autonomous plans, and continue simulation review before major resource movement.',
      ARRAY['Executive Decision Intelligence','Predictive Campaign Simulation','National Political Digital Twin','Autonomous Campaign Operations','Executive Forecast Engine','Command Center']
    )
    `,
    [workspaceId]
  );

  const missions = await pool.query(
    `
    INSERT INTO executive_ai_command_missions
    (
      workspace_id,
      title,
      mission_type,
      geographic_scope,
      state_name,
      status,
      priority,
      impact_percentage,
      confidence_percentage,
      risk_percentage,
      mission_summary,
      approval_status
    )
    VALUES
    ($1, 'Georgia Battleground Execution Mission', 'battleground_execution', 'Georgia', 'Georgia', 'pending_approval', 'high', 86, 88, 29, 'Approve a coordinated field, coalition, and vendor execution package for Georgia.', 'executive_review'),
    ($1, 'Pennsylvania Coalition Stabilization Mission', 'coalition_stabilization', 'Pennsylvania', 'Pennsylvania', 'pending_approval', 'high', 82, 84, 34, 'Deploy coalition monitoring and persuasion response tasks in Pennsylvania.', 'executive_review'),
    ($1, 'Arizona Vendor Readiness Recovery Mission', 'vendor_recovery', 'Arizona', 'Arizona', 'monitoring', 'medium', 74, 79, 42, 'Stabilize vendor readiness before approving expansion commitments in Arizona.', 'executive_review')
    RETURNING id, title
    `,
    [workspaceId]
  );

  const firstId = missions.rows[0]?.id;
  const secondId = missions.rows[1]?.id;
  const thirdId = missions.rows[2]?.id;

  if (firstId) {
    await pool.query(
      `
      INSERT INTO executive_ai_command_actions
      (workspace_id, mission_id, title, description, owner, status, approval_required, due_window)
      VALUES
      ($1, $2, 'Approve Command Center task conversion', 'Convert the Georgia mission package into operational tasks.', 'Executive Operations', 'queued', TRUE, '24 hours'),
      ($1, $2, 'Authorize vendor readiness verification', 'Confirm vendor coverage before mission activation.', 'Vendor Operations', 'queued', TRUE, '48 hours')
      `,
      [workspaceId, firstId]
    );
  }

  if (secondId) {
    await pool.query(
      `
      INSERT INTO executive_ai_command_actions
      (workspace_id, mission_id, title, description, owner, status, approval_required, due_window)
      VALUES
      ($1, $2, 'Assign coalition response owner', 'Assign a senior owner to coalition stabilization response.', 'Coalition Director', 'queued', TRUE, '24 hours'),
      ($1, $2, 'Prepare message testing task', 'Create a message testing task tied to coalition movement.', 'Strategy Team', 'queued', TRUE, '72 hours')
      `,
      [workspaceId, secondId]
    );
  }

  if (thirdId) {
    await pool.query(
      `
      INSERT INTO executive_ai_command_actions
      (workspace_id, mission_id, title, description, owner, status, approval_required, due_window)
      VALUES
      ($1, $2, 'Audit vendor capacity constraints', 'Identify vendor readiness gaps before expansion.', 'Vendor Operations', 'queued', TRUE, '48 hours')
      `,
      [workspaceId, thirdId]
    );
  }

  await pool.query(
    `
    INSERT INTO executive_ai_command_timeline
    (workspace_id, event_title, event_description, event_type, source_module, state_name, impact_percentage)
    VALUES
    ($1, 'Executive command brief generated', 'AI synthesized decision intelligence, predictive simulation, digital twin, and autonomous operations data.', 'command_brief', 'Executive AI Command Platform', 'National Coverage', 12),
    ($1, 'Georgia mission package recommended', 'Autonomous operations and digital twin models recommended Georgia execution escalation.', 'mission_recommendation', 'Autonomous Campaign Operations', 'Georgia', 14),
    ($1, 'Pennsylvania coalition stabilization flagged', 'Coalition intelligence created an executive command signal for Pennsylvania.', 'coalition_signal', 'National Coalition Intelligence', 'Pennsylvania', 9),
    ($1, 'Arizona vendor recovery routed for review', 'Vendor readiness risk was routed into the command approval queue.', 'vendor_risk', 'Vendor Intelligence Network', 'Arizona', 8)
    `,
    [workspaceId]
  );

  return { seeded: true };
}

export async function getExecutiveAiCommand(workspaceId = 1) {
  try {
    await ensureExecutiveAiCommandSchema(pool);

    const existing = await pool.query(
      `SELECT id FROM executive_ai_command_briefs WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    );

    if (!existing.rows.length) {
      await seedExecutiveAiCommand(workspaceId);
    }

    const [briefResult, missionsResult, actionsResult, timelineResult] = await Promise.all([
      pool.query(
        `
        SELECT *
        FROM executive_ai_command_briefs
        WHERE workspace_id = $1
        ORDER BY updated_at DESC
        LIMIT 1
        `,
        [workspaceId]
      ),
      pool.query(
        `
        SELECT *
        FROM executive_ai_command_missions
        WHERE workspace_id = $1
        ORDER BY priority DESC, impact_percentage DESC, confidence_percentage DESC, created_at DESC
        LIMIT 30
        `,
        [workspaceId]
      ),
      pool.query(
        `
        SELECT *
        FROM executive_ai_command_actions
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        LIMIT 100
        `,
        [workspaceId]
      ),
      pool.query(
        `
        SELECT *
        FROM executive_ai_command_timeline
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        LIMIT 40
        `,
        [workspaceId]
      ),
    ]);

    const brief = briefResult.rows[0] ? normalizeBrief(briefResult.rows[0]) : null;

    const missions = missionsResult.rows.map((mission) => {
      const actions = actionsResult.rows.filter((action) => Number(action.mission_id) === Number(mission.id));
      return normalizeMission(mission, actions);
    });

    const summary = {
      activeCommandBriefs: brief ? 1 : 0,
      activeExecutiveMissions: missions.length,
      queuedApprovalActions: actionsResult.rows.filter((action) => String(action.status || "").toLowerCase() === "queued").length,
      nationalReadinessPercentage: brief?.national_readiness_percentage || 0,
      aiConfidencePercentage: brief?.ai_confidence_percentage || 0,
      executionRiskPercentage: brief?.execution_risk_percentage || 0,
    };

    return {
      summary,
      brief,
      missions,
      timeline: timelineResult.rows,
    };
  } catch (error) {
    console.error("[Executive AI Command] service fallback:", error);
    return fallbackData(workspaceId);
  }
}

export async function generateExecutiveAiMission(workspaceId = 1, payload = {}) {
  await ensureExecutiveAiCommandSchema(pool);

  const result = await pool.query(
    `
    INSERT INTO executive_ai_command_missions
    (
      workspace_id,
      title,
      mission_type,
      geographic_scope,
      state_name,
      status,
      priority,
      impact_percentage,
      confidence_percentage,
      risk_percentage,
      mission_summary,
      approval_status,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,'pending_approval',$6,$7,$8,$9,$10,'executive_review',NOW())
    RETURNING *
    `,
    [
      workspaceId,
      payload.title || "Executive AI Mission Package",
      payload.mission_type || "executive_ai_mission",
      payload.geographic_scope || payload.state_name || "National Coverage",
      payload.state_name || payload.geographic_scope || "National Coverage",
      payload.priority || "medium",
      n(payload.impact_percentage, 78),
      n(payload.confidence_percentage, 84),
      n(payload.risk_percentage, 34),
      payload.mission_summary || "Executive AI generated a new mission package for leadership review.",
    ]
  );

  return {
    ok: true,
    mission: normalizeMission(result.rows[0], []),
  };
}

export async function getExecutiveAiCommandHealth() {
  await ensureExecutiveAiCommandSchema(pool);

  const result = await pool.query(`
    SELECT COUNT(*)::int AS brief_count, MAX(updated_at) AS last_updated
    FROM executive_ai_command_briefs
  `);

  return {
    ok: true,
    service: "executive-ai-command-platform",
    brief_count: result.rows[0]?.brief_count || 0,
    last_updated: result.rows[0]?.last_updated || null,
    timestamp: new Date().toISOString(),
  };
}
