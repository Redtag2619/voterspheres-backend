import { publishEvent } from "../lib/intelligence.events.js";

function nowIso() {
  return new Date().toISOString();
}

export function publishCampaignAlert({
  campaignId,
  type,
  title,
  message,
  severity = "medium",
  entityId = null,
  meta = {}
}) {
  if (!campaignId) return null;

  const event = {
    type: "campaign.alert",
    channel: `campaign:${campaignId}`,
    timestamp: nowIso(),
    payload: {
      id: `live-${Date.now()}`,
      campaign_id: campaignId,
      alert_key: `campaign:${campaignId}:${type}:${Date.now()}`,
      type,
      title,
      message,
      severity,
      entity_id: entityId,
      action_status: "open",
      meta,
      created_at: nowIso()
    }
  };

  publishEvent(event);
  return event;
}

export function publishCampaignActivity({
  campaignId,
  activityType,
  summary,
  metadata = {}
}) {
  if (!campaignId) return null;

  const event = {
    type: "campaign.activity",
    channel: `campaign:${campaignId}`,
    timestamp: nowIso(),
    payload: {
      id: `activity-${Date.now()}`,
      campaign_id: campaignId,
      activity_type: activityType,
      summary,
      details: metadata,
      created_at: nowIso()
    }
  };

  publishEvent(event);
  return event;
}

export function publishCampaignTaskUpdated({
  campaignId,
  task
}) {
  if (!campaignId || !task) return null;

  const event = {
    type: "task.updated",
    channel: `campaign:${campaignId}`,
    timestamp: nowIso(),
    payload: {
      ...task,
      campaign_id: campaignId
    }
  };

  publishEvent(event);
  return event;
}

export function publishCampaignVendorUpdated({
  campaignId,
  vendor
}) {
  if (!campaignId || !vendor) return null;

  const event = {
    type: "vendor.updated",
    channel: `campaign:${campaignId}`,
    timestamp: nowIso(),
    payload: {
      ...vendor,
      campaign_id: campaignId
    }
  };

  publishEvent(event);
  return event;
}

export function publishCampaignMailUpdated({
  campaignId,
  mailEvent
}) {
  if (!campaignId || !mailEvent) return null;

  const event = {
    type: "mail.updated",
    channel: `campaign:${campaignId}`,
    timestamp: nowIso(),
    payload: {
      ...mailEvent,
      campaign_id: campaignId
    }
  };

  publishEvent(event);
  return event;
}
