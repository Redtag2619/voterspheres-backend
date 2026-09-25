
import { resolveSelectableElectionCycle } from "../services/electionCycle.service.js";
import { sendElectionCycleError } from "../utils/electionCycle.js";

export function requireElectionCycle({ source = "query", field = "cycle" } = {}) {
  return async function electionCycleGuard(req, res, next) {
    try {
      const value = source === "body" ? req.body?.[field] : req.query?.[field];
      const cycle = await resolveSelectableElectionCycle(value);
      req.electionCycle = cycle;
      return next();
    } catch (error) {
      if (sendElectionCycleError(res, error)) return;
      return res.status(error.statusCode || 400).json({
        ok: false,
        error: error.message || "Invalid election cycle.",
        code: error.code || "INVALID_ELECTION_CYCLE",
      });
    }
  };
}
