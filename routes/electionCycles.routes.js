import express from "express";
import { requirePlatformOperator } from "../middleware/authorization.middleware.js";
import {
  activateElectionCycle,
  getCurrentElectionCycle,
  listElectionCycles,
} from "../services/electionCycle.service.js";
import { sendElectionCycleError } from "../utils/electionCycle.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const selectableOnly = String(req.query.selectable_only || "true").toLowerCase() !== "false";
    const [cycles, current] = await Promise.all([
      listElectionCycles({ selectableOnly }),
      getCurrentElectionCycle(),
    ]);
    return res.json({
      ok: true,
      current_cycle: current?.cycle_year || null,
      cycles: cycles.map((row) => ({
        year: row.cycle_year,
        label: row.label,
        status: row.status,
        selectable: row.is_selectable,
        starts_on: row.starts_on,
        ends_on: row.ends_on,
      })),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Failed to load election cycles." });
  }
});

router.post("/:year/activate", requirePlatformOperator, async (req, res) => {
  try {
    const cycle = await activateElectionCycle(req.params.year);
    return res.json({ ok: true, message: `Election cycle ${cycle.cycle_year} is now current.`, cycle });
  } catch (error) {
    if (sendElectionCycleError(res, error)) return;
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || "Failed to activate election cycle." });
  }
});

export default router;
