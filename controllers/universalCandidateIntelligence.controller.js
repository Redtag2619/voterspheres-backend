import {
  getUniversalProviderHealth,
  listUniversalCandidates,
  resolveUniversalCandidate,
} from "../services/universalCandidateRegistry.service.js";
import { getCandidateIntelligenceBundle } from "../services/candidateIntelligenceBundle.service.js";

export async function getUniversalCandidateHealthController(_req, res, next) {
  try {
    res.json(await getUniversalProviderHealth());
  } catch (error) {
    next(error);
  }
}

export async function resolveUniversalCandidateController(req, res, next) {
  try {
    const context = {
      ...(req.body || {}),
      workspaceId: req.body?.workspace_id || req.user?.workspace_id || 1,
      user: req.user || req.auth || {},
    };
    const resolution = await resolveUniversalCandidate(context);
    if (req.body?.include_brief === false) {
      return res.json({ ok: resolution.status === "resolved", resolution });
    }
    const briefing = await getCandidateIntelligenceBundle(context);
    return res.json({ ok: briefing.ok, resolution, briefing });
  } catch (error) {
    next(error);
  }
}

export async function listUniversalCandidatesController(req, res, next) {
  try {
    const result = await listUniversalCandidates({
      q: req.query?.q,
      state: req.query?.state,
      office: req.query?.office,
      cycle: req.query?.cycle,
      party: req.query?.party,
      ballotStatus: req.query?.ballot_status,
      page: req.query?.page,
      limit: req.query?.limit,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

