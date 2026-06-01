import {
  addWorkspaceMember,
  addWorkspaceTarget,
  createCampaignWorkspace,
  getCampaignWorkspace,
  listCampaignWorkspaces,
  updateCampaignWorkspace,
} from "../services/campaignWorkspaces.service.js";

export async function listCampaignWorkspacesController(req, res) {
  try {
    const workspaces = await listCampaignWorkspaces({
      user: req.user || req.auth || {},
    });

    return res.json({
      ok: true,
      workspaces,
    });
  } catch (error) {
    console.error("[workspaces] list failed", error);

    return res.status(500).json({
      error: "Failed to load campaign workspaces.",
      detail: error.message,
    });
  }
}

export async function getCampaignWorkspaceController(req, res) {
  try {
    const data = await getCampaignWorkspace({
      id: req.params.id,
      user: req.user || req.auth || {},
    });

    return res.json({
      ok: true,
      ...data,
    });
  } catch (error) {
    console.error("[workspaces] get failed", error);

    return res.status(404).json({
      error: "Failed to load campaign workspace.",
      detail: error.message,
    });
  }
}

export async function createCampaignWorkspaceController(req, res) {
  try {
    const workspace = await createCampaignWorkspace({
      payload: req.body || {},
      user: req.user || req.auth || {},
    });

    return res.status(201).json({
      ok: true,
      workspace,
    });
  } catch (error) {
    console.error("[workspaces] create failed", error);

    return res.status(500).json({
      error: "Failed to create campaign workspace.",
      detail: error.message,
    });
  }
}

export async function updateCampaignWorkspaceController(req, res) {
  try {
    const workspace = await updateCampaignWorkspace({
      id: req.params.id,
      payload: req.body || {},
      user: req.user || req.auth || {},
    });

    return res.json({
      ok: true,
      workspace,
    });
  } catch (error) {
    console.error("[workspaces] update failed", error);

    return res.status(500).json({
      error: "Failed to update campaign workspace.",
      detail: error.message,
    });
  }
}

export async function addWorkspaceMemberController(req, res) {
  try {
    const member = await addWorkspaceMember({
      workspaceId: req.params.id,
      payload: req.body || {},
    });

    return res.status(201).json({
      ok: true,
      member,
    });
  } catch (error) {
    console.error("[workspaces] add member failed", error);

    return res.status(500).json({
      error: "Failed to add workspace member.",
      detail: error.message,
    });
  }
}

export async function addWorkspaceTargetController(req, res) {
  try {
    const target = await addWorkspaceTarget({
      workspaceId: req.params.id,
      payload: req.body || {},
    });

    return res.status(201).json({
      ok: true,
      target,
    });
  } catch (error) {
    console.error("[workspaces] add target failed", error);

    return res.status(500).json({
      error: "Failed to add workspace target.",
      detail: error.message,
    });
  }
}
