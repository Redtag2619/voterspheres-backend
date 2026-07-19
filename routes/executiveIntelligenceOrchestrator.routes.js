import express from "express";

import { requireAuth } from "../middleware/auth.middleware.js";

import {

  createExecutiveIntelligencePlan,

  getExecutiveOrchestratorConfiguration,

  runExecutiveIntelligenceOrchestrator,

} from "../services/executiveIntelligenceOrchestrator.service.js";


const router = express.Router();


function getAuthenticatedUser(req) {

  return req.user || req.auth || {};

}


/**

 * GET /api/executive-intelligence-orchestrator/config

 */

router.get(

  "/config",

  requireAuth,

  (_req, res) => {

    return res.json(

      getExecutiveOrchestratorConfiguration()

    );

  }

);


/**

 * POST /api/executive-intelligence-orchestrator/plan

 *

 * Returns the resolved context and tool plan without executing it.

 */

router.post(

  "/plan",

  requireAuth,

  (req, res) => {

    try {

      const output =

        createExecutiveIntelligencePlan({

          payload:

            req.body || {},

        });


      return res.json(output);

    } catch (error) {

      return res

        .status(error.status || 500)

        .json({

          ok: false,

          error:

            error.message ||

            "Failed to build the executive intelligence plan.",

        });

    }

  }

);


/**

 * POST /api/executive-intelligence-orchestrator/brief

 *

 * Example:

 * {

 *   "question": "What are the latest developments in Georgia's 2026 political races?",

 *   "state": "GA",

 *   "cycle": "2026",

 *   "workspace_id": 1,

 *   "limit": 10

 * }

 */

router.post(

  "/brief",

  requireAuth,

  async (req, res) => {

    try {

      const output =

        await runExecutiveIntelligenceOrchestrator({

          user:

            getAuthenticatedUser(req),


          payload:

            req.body || {},

        });


      return res

        .status(output.ok ? 200 : 206)

        .json(output);

    } catch (error) {

      console.error(

        "[executive-intelligence-orchestrator] briefing failed",

        {

          name:

            error?.name,

          message:

            error?.message,

          stack:

            error?.stack,

        }

      );


      return res

        .status(error.status || 500)

        .json({

          ok: false,

          build: "3.6.0",

          error:

            error.message ||

            "Executive Intelligence Orchestrator failed.",

        });

    }

  }

);


export default router;
