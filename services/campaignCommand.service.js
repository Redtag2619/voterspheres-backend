import {
  publishCampaignActivity,
  publishCampaignAlert,
  publishCampaignTaskUpdated,
  publishCampaignVendorUpdated
} from "./campaignAlerts.service.js";

function nowIso() {
  return new Date().toISOString();
}

export async function getCampaignCommandCenter(campaignId) {
  return {
    campaign: {
      id: campaignId,
      campaign_name: "Georgia Senate Victory",
      candidate_name: "Jane Doe",
      firm_name: "Red Tag Strategies",
      owner_name: "Mark Stephens",
      stage: "General",
      status: "active"
    },
    metrics: [
      { label: "Open Alerts", value: "2", delta: "+1", tone: "down" },
      { label: "Open Tasks", value: "4", delta: "Execution queue", tone: "up" },
      { label: "Active Vendors", value: "3", delta: "Live relationships", tone: "up" }
    ],
    alerts: [],
    contacts: [],
    vendors: [],
    tasks: [],
    documents: [],
    fundraising: null,
    forecast: { snapshot: null, races: [] },
    mail: {
      programs: [],
      drops: [],
      recent_events: [],
      delayed_events: [],
      delivered_events: []
    }
  };
}

export async function getCampaignActivity(campaignId) {
  return [
    {
      id: `seed-${campaignId}-1`,
      campaign_id: campaignId,
      activity_type: "workspace_loaded",
      summary: "Campaign workspace initialized",
      details: { actor: "system" },
      created_at: nowIso()
    }
  ];
}

export async function createCampaignTask(campaignId, payload = {}) {
  const task = {
    id: Date.now(),
    campaign_id: campaignId,
    title: payload.title || "Untitled task",
    description: payload.description || "",
    priority: payload.priority || "medium",
    status: payload.status || "todo",
    created_at: nowIso()
  };

  publishCampaignTaskUpdated({ campaignId, task });

  publishCampaignActivity({
    campaignId,
    activityType: "task_created",
    summary: `Task created: ${task.title}`,
    metadata: {
      actor: "user",
      task_id: task.id,
      priority: task.priority,
      status: task.status
    }
  });

  if (String(task.priority).toLowerCase() === "high") {
    publishCampaignAlert({
      campaignId,
      type: "task",
      title: "High-priority task created",
      message: `${task.title} was created as a high-priority task.`,
      severity: "medium",
      entityId: task.id,
      meta: { task_id: task.id }
    });
  }

  return task;
}

export async function updateCampaignTask(campaignId, taskId, payload = {}) {
  const task = {
    id: taskId,
    campaign_id: campaignId,
    title: payload.title || "Updated task",
    description: payload.description || "",
    priority: payload.priority || "medium",
    status: payload.status || "todo",
    updated_at: nowIso()
  };

  publishCampaignTaskUpdated({ campaignId, task });

  publishCampaignActivity({
    campaignId,
    activityType: "task_updated",
    summary: `Task updated: ${task.title}`,
    metadata: {
      actor: "user",
      task_id: task.id,
      priority: task.priority,
      status: task.status
    }
  });

  if (String(task.status).toLowerCase() === "done") {
    publishCampaignAlert({
      campaignId,
      type: "task",
      title: "Task completed",
      message: `${task.title} was marked done.`,
      severity: "low",
      entityId: task.id,
      meta: { task_id: task.id }
    });
  }

  return task;
}

export async function createCampaignVendor(campaignId, payload = {}) {
  const vendor = {
    id: Date.now(),
    campaign_id: campaignId,
    vendor_name: payload.vendor_name || "Unnamed Vendor",
    category: payload.category || "General",
    status: payload.status || "active",
    contract_value: Number(payload.contract_value || 0),
    created_at: nowIso()
  };

  publishCampaignVendorUpdated({ campaignId, vendor });

  publishCampaignActivity({
    campaignId,
    activityType: "vendor_created",
    summary: `Vendor added: ${vendor.vendor_name}`,
    metadata: {
      actor: "user",
      vendor_id: vendor.id,
      status: vendor.status,
      category: vendor.category
    }
  });

  return vendor;
}

export async function updateCampaignVendor(campaignId, vendorId, payload = {}) {
  const vendor = {
    id: vendorId,
    campaign_id: campaignId,
    vendor_name: payload.vendor_name || "Updated Vendor",
    category: payload.category || "General",
    status: payload.status || "active",
    contract_value: Number(payload.contract_value || 0),
    updated_at: nowIso()
  };

  publishCampaignVendorUpdated({ campaignId, vendor });

  publishCampaignActivity({
    campaignId,
    activityType: "vendor_updated",
    summary: `Vendor updated: ${vendor.vendor_name}`,
    metadata: {
      actor: "user",
      vendor_id: vendor.id,
      status: vendor.status
    }
  });

  if (String(vendor.status).toLowerCase() === "at_risk") {
    publishCampaignAlert({
      campaignId,
      type: "vendor",
      title: "Vendor marked at risk",
      message: `${vendor.vendor_name} is now marked at risk.`,
      severity: "high",
      entityId: vendor.id,
      meta: { vendor_id: vendor.id }
    });
  }

  return vendor;
}
