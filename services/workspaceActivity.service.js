import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || null;
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[workspace-activity]", error.message);
    return [];
  }
}

export async function getWorkspaceActivity({ user = {} }) {
  const firmId = getFirmId(user);

  const tasks = await safeQuery(`
    SELECT
      id,
      'task' as type,
      title,
      updated_at as activity_time
    FROM tasks
    WHERE firm_id = $1
    ORDER BY updated_at DESC
    LIMIT 10
  `, [firmId]);

  const crm = await safeQuery(`
    SELECT
      id,
      'crm' as type,
      full_name as title,
      updated_at as activity_time
    FROM campaign_crm_contacts
    WHERE firm_id = $1
    ORDER BY updated_at DESC
    LIMIT 10
  `, [firmId]);

  const reports = await safeQuery(`
    SELECT
      id,
      'report' as type,
      title,
      COALESCE(updated_at,created_at) as activity_time
    FROM intelligence_reports
    WHERE firm_id = $1
    ORDER BY COALESCE(updated_at,created_at) DESC
    LIMIT 10
  `, [firmId]);

  const clients = await safeQuery(`
    SELECT
      id,
      'client' as type,
      client_name as title,
      updated_at as activity_time
    FROM consultant_clients
    WHERE firm_id = $1
    ORDER BY updated_at DESC
    LIMIT 10
  `, [firmId]);

  const notifications = await safeQuery(`
    SELECT
      id,
      'notification' as type,
      title,
      created_at as activity_time
    FROM notification_events
    WHERE firm_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `, [firmId]);

  const activity = [
    ...tasks,
    ...crm,
    ...reports,
    ...clients,
    ...notifications,
  ]
    .sort(
      (a, b) =>
        new Date(b.activity_time).getTime() -
        new Date(a.activity_time).getTime()
    )
    .slice(0, 50);

  return {
    total_activity: activity.length,
    activity,
    updated_at: new Date().toISOString(),
  };
}
