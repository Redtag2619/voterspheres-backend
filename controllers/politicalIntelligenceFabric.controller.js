import {

  getPoliticalFabricOverview,

  runPoliticalIntelligenceScan,

  createPoliticalBrief,

  runPoliticalScenario,

  listPoliticalBriefs,

  getPoliticalBrief,

  listWatchlist,

  upsertWatchlist,

  deleteWatchlist,

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

  return (

    Number(

      req.user?.id ||

        req.user?.user_id ||

        req.user?.userId

    ) || null

  );

}

 

function requireWorkspace(req, res) {

  const workspaceId = workspaceIdFrom(req);

 

  if (!workspaceId) {

    res.status(400).json({

      ok: false,

      error: "workspace_id is required",

    });

 

    return null;

  }

 

  return workspaceId;

}

 

function booleanOption(value, fallback = true) {

  if (value === undefined || value === null || value === "") {

    return fallback;

  }

 

  if (typeof value === "boolean") return value;

 

  return !["false", "0", "no", "off"].includes(

    String(value).trim().toLowerCase()

  );

}

 

function sendFailure(res, status, error, publicMessage) {

  return res.status(status).json({

    ok: false,

    error: publicMessage,

    detail:

      process.env.NODE_ENV === "production"

        ? undefined

        : error?.message,

  });

}

 

export async function getPoliticalFabricHealth(req, res) {

  const workspaceId = requireWorkspace(req, res);

  if (!workspaceId) return;

 

  return res.json({

    ok: true,

    service: "political-intelligence-fabric",

    build: "5.1-live-signals",

    workspace_id: workspaceId,

    live_sources_enabled: true,

    timestamp: new Date().toISOString(),

  });

}

 

export async function getPoliticalFabricOverviewController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

 

    const result = await getPoliticalFabricOverview({

      workspaceId,

      includeLiveSources: booleanOption(

        req.query?.include_live_sources,

        true

      ),

      refreshLiveSources: booleanOption(

        req.query?.refresh_live_sources,

        false

      ),

    });

 

    return res.json(result);

  } catch (error) {

    console.error(

      "[PoliticalFabric] overview failed:",

      error

    );

 

    return sendFailure(

      res,

      500,

      error,

      "Unable to load Political Intelligence Fabric overview"

    );

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

      limit: req.body?.limit,

      includeLiveSources: booleanOption(

        req.body?.include_live_sources,

        true

      ),

      refreshLiveSources: booleanOption(

        req.body?.refresh_live_sources,

        true

      ),

      liveSourceOptions: {

        includeNews: booleanOption(

          req.body?.include_news,

          true

        ),

        includeFec: booleanOption(

          req.body?.include_fec,

          true

        ),

        includePolling: booleanOption(

          req.body?.include_polling,

          true

        ),

        includeLegislation: booleanOption(

          req.body?.include_legislation,

          true

        ),

        includeElectionAdministration: booleanOption(

          req.body?.include_election_administration,

          true

        ),

        includeWeatherRisk: booleanOption(

          req.body?.include_weather_risk,

          true

        ),

      },

    });

 

    return res.json(result);

  } catch (error) {

    console.error(

      "[PoliticalFabric] scan failed:",

      error

    );

 

    return sendFailure(

      res,

      500,

      error,

      "Unable to run political intelligence scan"

    );

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

      timeHorizon: req.body?.time_horizon,

      includeLiveSources: booleanOption(

        req.body?.include_live_sources,

        true

      ),

    });

 

    return res.status(201).json(brief);

  } catch (error) {

    console.error(

      "[PoliticalFabric] create brief failed:",

      error

    );

 

    return sendFailure(

      res,

      500,

      error,

      "Unable to create political intelligence brief"

    );

  }

}

 

export async function listPoliticalBriefsController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

 

    return res.json(

      await listPoliticalBriefs({

        workspaceId,

        limit: req.query?.limit,

      })

    );

  } catch (error) {

    console.error(

      "[PoliticalFabric] list briefs failed:",

      error

    );

 

    return sendFailure(

      res,

      500,

      error,

      "Unable to list political intelligence briefs"

    );

  }

}

 

export async function getPoliticalBriefController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

 

    const brief = await getPoliticalBrief({

      workspaceId,

      briefId: req.params.id,

    });

 

    if (!brief) {

      return res.status(404).json({

        ok: false,

        error: "Brief not found",

      });

    }

 

    return res.json(brief);

  } catch (error) {

    console.error(

      "[PoliticalFabric] read brief failed:",

      error

    );

 

    return sendFailure(

      res,

      500,

      error,

      "Unable to read political intelligence brief"

    );

  }

}

 

export async function listWatchlistController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

 

    return res.json(

      await listWatchlist({

        workspaceId,

        status: req.query?.status,

      })

    );

  } catch (error) {

    console.error(

      "[PoliticalFabric] list watchlist failed:",

      error

    );

 

    return sendFailure(

      res,

      500,

      error,

      "Unable to list political intelligence watchlist"

    );

  }

}

 

export async function upsertWatchlistController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

 

    if (

      !req.body?.entity_type ||

      !req.body?.entity_name

    ) {

      return res.status(400).json({

        ok: false,

        error:

          "entity_type and entity_name are required",

      });

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

      tags: req.body.tags,

    });

 

    return res.status(201).json(item);

  } catch (error) {

    console.error(

      "[PoliticalFabric] save watchlist failed:",

      error

    );

 

    return sendFailure(

      res,

      500,

      error,

      "Unable to save political intelligence watchlist item"

    );

  }

}

 

export async function deleteWatchlistController(req, res) {

  try {

    const workspaceId = requireWorkspace(req, res);

    if (!workspaceId) return;

 

    const deleted = await deleteWatchlist({

      workspaceId,

      watchlistId: req.params.id,

    });

 

    if (!deleted) {

      return res.status(404).json({

        ok: false,

        error: "Watchlist item not found",

      });

    }

 

    return res.status(204).send();

  } catch (error) {

    console.error(

      "[PoliticalFabric] delete watchlist failed:",

      error

    );

 

    return sendFailure(

      res,

      500,

      error,

      "Unable to delete political intelligence watchlist item"

    );

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

      assumptions: req.body?.assumptions || {},

    });

 

    return res.status(201).json(scenario);

  } catch (error) {

    console.error(

      "[PoliticalFabric] scenario failed:",

      error

    );

 

    return sendFailure(

      res,

      500,

      error,

      "Unable to run political intelligence scenario"

    );

  }

}