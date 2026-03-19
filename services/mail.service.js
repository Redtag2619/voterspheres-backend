import {
  addMailTrackingEvent,
  createMailProgram,
  ensureMailTables,
  getCampaignMailTracking,
  getMailDashboard,
  getMailProgramById,
  listMailPrograms
} from "../repositories/mail.repository.js";

export async function initMailModule(req, res, next) {
  try {
    await ensureMailTables();
    res.json({ ok: true, message: "MailOps tables ready" });
  } catch (err) {
    next(err);
  }
}

export async function createMailProgramHandler(req, res, next) {
  try {
    const created = await createMailProgram(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

export async function addMailTrackingEventHandler(req, res, next) {
  try {
    const created = await addMailTrackingEvent(req.params.id, req.body || {});
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

export async function listMailProgramsHandler(req, res, next) {
  try {
    const data = await listMailPrograms({
      search: req.query.search || "",
      status: req.query.status || "",
      state: req.query.state || "",
      campaign_id: req.query.campaign_id || "",
      firm_id: req.query.firm_id || "",
      page: req.query.page || 1,
      limit: req.query.limit || 25
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getMailProgramHandler(req, res, next) {
  try {
    const program = await getMailProgramById(req.params.id);

    if (!program) {
      return res.status(404).json({ error: "mail program not found" });
    }

    res.json(program);
  } catch (err) {
    next(err);
  }
}

export async function getMailDashboardHandler(req, res, next) {
  try {
    const data = await getMailDashboard({
      firm_id: req.query.firm_id || "",
      campaign_id: req.query.campaign_id || ""
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getCampaignMailTrackingHandler(req, res, next) {
  try {
    const data = await getCampaignMailTracking(req.params.campaignId);

    if (!data) {
      return res.status(404).json({ error: "campaign not found" });
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
}
