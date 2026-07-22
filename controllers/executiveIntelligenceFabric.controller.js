import { createExecutiveIntelligenceFabric } from "../services/executiveIntelligenceFabric.service.js";

import { createExecutiveMemoryService } from "../services/executiveMemory.service.js";

import { createExecutiveFabricAdapters } from "../adapters/executiveFabric.adapters.js";

 

const fabric = createExecutiveIntelligenceFabric({

  adapters: createExecutiveFabricAdapters(),

  memory: createExecutiveMemoryService()

});

 

const workspaceId = (req) =>

  Number(req.body?.workspace_id || req.query?.workspace_id || req.user?.workspace_id || 1);

 

const userId = (req) => req.user?.id || req.user?.user_id || null;

 

export async function getFabricHealth(req, res, next) {

  try {

    res.json(await fabric.health());

  } catch (error) {

    next(error);

  }

}

 

export async function planFabricRequest(req, res, next) {

  try {

    const question = String(req.body?.question || "").trim();

    if (!question) {

      return res.status(400).json({

        ok: false,

        code: "QUESTION_REQUIRED",

        error: "An executive intelligence question is required."

      });

    }

 

    res.json({

      ...(await fabric.plan({ question, context: req.body?.context || req.body || {} })),

      workspace_id: workspaceId(req)

    });

  } catch (error) {

    next(error);

  }

}

 

export async function createFabricBrief(req, res, next) {

  try {

    const question = String(req.body?.question || "").trim();

    if (!question) {

      return res.status(400).json({

        ok: false,

        code: "QUESTION_REQUIRED",

        error: "An executive intelligence question is required."

      });

    }

 

    res.json(

      await fabric.brief({

        question,

        workspace_id: workspaceId(req),

        user_id: userId(req),

        context: req.body?.context || req.body || {}

      })

    );

  } catch (error) {

    next(error);

  }

}

 

export async function simulateFabricScenario(req, res, next) {

  try {

    const question = String(req.body?.question || "").trim();

    if (!question) {

      return res.status(400).json({

        ok: false,

        code: "QUESTION_REQUIRED",

        error: "A simulation question is required."

      });

    }

 

    res.json(

      await fabric.simulate({

        question,

        workspace_id: workspaceId(req),

        context: req.body?.context || req.body || {},

        scenarios: req.body?.scenarios || []

      })

    );

  } catch (error) {

    next(error);

  }

}
