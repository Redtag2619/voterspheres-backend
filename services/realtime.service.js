import { publishEvent } from "../lib/intelligence.events.js";

export const REALTIME_EVENTS = {
  COUNTY_ESCALATION_CREATED: "county.escalation.created",
  COUNTY_ESCALATION_RESOLVED: "county.escalation.resolved",
  TASK_CREATED: "task.created",
  TASK_UPDATED: "task.updated",
  TASK_COMPLETED: "task.completed",
  WORKSPACE_PRESSURE_CHANGED: "workspace.pressure.changed",
  STATE_HEAT_UPDATED: "state.heat.updated",
  VENDOR_GAP_DETECTED: "vendor.gap.detected",
  MAILOPS_RISK_DETECTED: "mailops.risk.detected",
  EXECUTIVE_ALERT_CREATED: "executive.alert.created",
};

export function emitRealtimeEvent({
  type,
  channel,
  payload = {},
  workspace_id = null,
  firm_id = null,
  state = null,
}) {
  return publishEvent({
    type: type || "voterspheres.event",
    channel: channel || "voterspheres:global",
    workspace_id,
    firm_id,
    state,
    payload,
    timestamp: new Date().toISOString(),
  });
}

export function emitTaskRealtime(task = {}, eventType = REALTIME_EVENTS.TASK_UPDATED) {
  return emitRealtimeEvent({
    type: eventType,
    channel: "tasks",
    workspace_id: task.workspace_id,
    firm_id: task.firm_id,
    state: task.state,
    payload: {
      task,
      task_id: task.id,
      status: task.status,
      priority: task.priority,
      source: task.source,
    },
  });
}

export function emitCountyEscalationRealtime(task = {}, eventType = REALTIME_EVENTS.COUNTY_ESCALATION_CREATED) {
  const metadata = task.metadata || {};

  return emitRealtimeEvent({
    type: eventType,
    channel: "operations:county",
    workspace_id: task.workspace_id,
    firm_id: task.firm_id,
    state: task.state || metadata.state || metadata.state_code,
    payload: {
      task,
      task_id: task.id,
      county: metadata.county || metadata.county_name,
      heat_score: metadata.heat_score,
      risk: metadata.risk || task.priority,
      status: task.status,
    },
  });
}
