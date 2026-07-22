import {

  getPoliticalFabricOverview,

  runPoliticalIntelligenceScan,

  createPoliticalBrief,

  runPoliticalScenario,

  listPoliticalBriefs,

  getPoliticalBrief,

  listWatchlist,

  upsertWatchlist,

  deleteWatchlist

} from "../services/politicalIntelligenceFabric.service.js";

 

function workspaceIdFrom(req) {

  return Number(

    req.user?.workspace_id ||

    req.user?.workspaceId ||

    req.query?.workspace_id ||

    req.body?.workspace_id

  );

}

 

function userIdFrom(req) {

  return Number(req.user?.id || req.user?.user_id || req.user?.userId) || null;

}

 

function requireWorkspace(req, res) {

  const workspaceId = workspaceIdFrom(req);

  if (!workspaceId) {

    res.status(400).json({ error: "workspace_id is required" });

    return null;

  }

  return workspaceId;

}

 

export async function getPoliticalFabricHealth(req, res) {

  const workspaceId = requireWorkspace(req, res);

  if (!workspaceId) return;

 

  res.json({

    ok: true,

    service: "political-intelligence-fabric",

    build: "5.0",

    workspace_id: workspaceId,

    timestamp: new Date().toISOString()

  });

}

 

export async function getPoliticalFabricOverviewController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

    res.json(await getPoliticalFabricOverview({ workspaceId }));

  } catch (error) {

    console.error("[PoliticalFabric] overview failed:", error);

    res.status(500).json({ error: "Unable to load Political Intelligence Fabric overview" });

  }

}

 

export async function runPoliticalScanController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

 

    const result = await runPoliticalIntelligenceScan({

      workspaceId,

      scopeType: req.body?.scope_type,

      scopeValue: req.body?.scope_value,

      stateCode: req.body?.state_code,

      timeHorizon: req.body?.time_horizon,

      limit: req.body?.limit

    });

 

    res.json(result);

  } catch (error) {

    console.error("[PoliticalFabric] scan failed:", error);

    res.status(500).json({ error: "Unable to run political intelligence scan" });

  }

}

 

export async function createPoliticalBriefController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

 

    const brief = await createPoliticalBrief({

      workspaceId,

      userId: userIdFrom(req),

      title: req.body?.title,

      scopeType: req.body?.scope_type,

      scopeValue: req.body?.scope_value,

      stateCode: req.body?.state_code,

      timeHorizon: req.body?.time_horizon

    });

 

    res.status(201).json(brief);

  } catch (error) {

    console.error("[PoliticalFabric] create brief failed:", error);

    res.status(500).json({ error: "Unable to create political intelligence brief" });

  }

}

 

export async function listPoliticalBriefsController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

    res.json(await listPoliticalBriefs({ workspaceId, limit: req.query?.limit }));

  } catch (error) {

    console.error("[PoliticalFabric] list briefs failed:", error);

    res.status(500).json({ error: "Unable to list political intelligence briefs" });

  }

}

 

export async function getPoliticalBriefController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

    const brief = await getPoliticalBrief({ workspaceId, briefId: req.params.id });

    if (!brief) return res.status(404).json({ error: "Brief not found" });

    res.json(brief);

  } catch (error) {

    console.error("[PoliticalFabric] read brief failed:", error);

    res.status(500).json({ error: "Unable to read political intelligence brief" });

  }

}

 

export async function listWatchlistController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

    res.json(await listWatchlist({ workspaceId, status: req.query?.status }));

  } catch (error) {

    console.error("[PoliticalFabric] list watchlist failed:", error);

    res.status(500).json({ error: "Unable to list political intelligence watchlist" });

  }

}

 

export async function upsertWatchlistController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

 

    if (!req.body?.entity_type || !req.body?.entity_name) {

      return res.status(400).json({ error: "entity_type and entity_name are required" });

    }

 

    const item = await upsertWatchlist({

      workspaceId,

      userId: userIdFrom(req),

      entityType: req.body.entity_type,

      entityId: req.body.entity_id,

      entityName: req.body.entity_name,

      stateCode: req.body.state_code,

      priority: req.body.priority,

      status: req.body.status,

      rationale: req.body.rationale,

      thresholds: req.body.thresholds,

      tags: req.body.tags

    });

 

    res.status(201).json(item);

  } catch (error) {

    console.error("[PoliticalFabric] save watchlist failed:", error);

    res.status(500).json({ error: "Unable to save political intelligence watchlist item" });

  }

}

 

export async function deleteWatchlistController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

    const deleted = await deleteWatchlist({ workspaceId, watchlistId: req.params.id });

    if (!deleted) return res.status(404).json({ error: "Watchlist item not found" });

    res.status(204).send();

  } catch (error) {

    console.error("[PoliticalFabric] delete watchlist failed:", error);

    res.status(500).json({ error: "Unable to delete political intelligence watchlist item" });

  }

}

 

export async function runPoliticalScenarioController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

 

    const scenario = await runPoliticalScenario({

      workspaceId,

      userId: userIdFrom(req),

      name: req.body?.name,

      scenarioType: req.body?.scenario_type,

      assumptions: req.body?.assumptions || {}

    });

 

    res.status(201).json(scenario);

  } catch (error) {

    console.error("[PoliticalFabric] scenario failed:", error);

    res.status(500).json({ error: "Unable to run political intelligence scenario" });

  }

}
