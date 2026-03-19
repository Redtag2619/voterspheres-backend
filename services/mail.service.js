import {
  createMailDrop,
  createMailProgram,
  createMailTrackingEvent,
  ensureMailTables,
  getCampaignMailTimeline,
  getMailDashboard,
  getMailDropTimeline,
  getPlatformMailTimeline,
  listMailDrops,
  listMailPrograms
} from "../repositories/mail.repository.js";

export async function initMailTables(req, res, next) {
  try {
    await ensureMailTables();
    res.json({ ok: true, message: "MailOps tables initialized" });
  } catch (err) {
    next(err);
  }
}

export async function createMailProgramHandler(req, res, next) {
  try {
    const record = await createMailProgram(req.body);
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

export async function listMailProgramsHandler(req, res, next) {
  try {
    const results = await listMailPrograms(req.query || {});
    res.json({ results });
  } catch (err) {
    next(err);
  }
}

export async function createMailDropHandler(req, res, next) {
  try {
    const record = await createMailDrop(req.body);
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

export async function listMailDropsHandler(req, res, next) {
  try {
    const results = await listMailDrops(req.query || {});
    res.json({ results });
  } catch (err) {
    next(err);
  }
}

export async function createMailTrackingEventHandler(req, res, next) {
  try {
    const record = await createMailTrackingEvent(req.body);
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

export async function getMailDropTimelineHandler(req, res, next) {
  try {
    const results = await getMailDropTimeline(req.params.id);
    res.json({ results });
  } catch (err) {
    next(err);
  }
}

export async function getCampaignMailTimelineHandler(req, res, next) {
  try {
    const results = await getCampaignMailTimeline(req.params.campaignId);
    res.json({ results });
  } catch (err) {
    next(err);
  }
}

export async function getPlatformMailTimelineHandler(req, res, next) {
  try {
    const limit = req.query.limit || 50;
    const results = await getPlatformMailTimeline(limit);
    res.json({ results });
  } catch (err) {
    next(err);
  }
}

export async function getMailDashboardHandler(req, res, next) {
  try {
    const dashboard = await getMailDashboard();
    res.json(dashboard);
  } catch (err) {
    next(err);
  }
}
