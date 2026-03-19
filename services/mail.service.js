import {
  createMailDrop,
  createMailProgram,
  createMailTrackingEvent,
  ensureMailTables,
  getCampaignMailWorkspace,
  getMailDashboard,
  getMailProgramById,
  listMailDrops,
  listMailPrograms,
  listMailTrackingEvents
} from "../repositories/mail.repository.js";

export async function initMailModule(req, res, next) {
  try {
    await ensureMailTables();
    res.json({ status: "ok", message: "MailOps tables ready" });
  } catch (err) {
    next(err);
  }
}

export async function createProgram(req, res, next) {
  try {
    const {
      campaign_id,
      name,
      vendor_name,
      mail_type,
      target_universe,
      quantity,
      budget,
      status,
      in_home_start,
      in_home_end,
      notes
    } = req.body || {};

    if (!campaign_id || !name) {
      return res.status(400).json({
        error: "campaign_id and name are required"
      });
    }

    const program = await createMailProgram({
      campaign_id,
      name,
      vendor_name,
      mail_type,
      target_universe,
      quantity,
      budget,
      status,
      in_home_start,
      in_home_end,
      notes
    });

    res.status(201).json(program);
  } catch (err) {
    next(err);
  }
}

export async function getPrograms(req, res, next) {
  try {
    const results = await listMailPrograms({
      campaign_id: req.query.campaign_id || "",
      firm_id: req.query.firm_id || "",
      status: req.query.status || ""
    });

    res.json({ results });
  } catch (err) {
    next(err);
  }
}

export async function createDrop(req, res, next) {
  try {
    const {
      program_id,
      campaign_id,
      drop_name,
      drop_date,
      entered_at,
      usps_entry_facility,
      region,
      quantity,
      expected_delivery_start,
      expected_delivery_end,
      actual_delivery_date,
      status,
      tracking_status,
      notes
    } = req.body || {};

    if (!program_id || !campaign_id || !drop_name) {
      return res.status(400).json({
        error: "program_id, campaign_id, and drop_name are required"
      });
    }

    const drop = await createMailDrop({
      program_id,
      campaign_id,
      drop_name,
      drop_date,
      entered_at,
      usps_entry_facility,
      region,
      quantity,
      expected_delivery_start,
      expected_delivery_end,
      actual_delivery_date,
      status,
      tracking_status,
      notes
    });

    res.status(201).json(drop);
  } catch (err) {
    next(err);
  }
}

export async function getDrops(req, res, next) {
  try {
    const results = await listMailDrops({
      program_id: req.query.program_id || "",
      campaign_id: req.query.campaign_id || "",
      firm_id: req.query.firm_id || "",
      status: req.query.status || ""
    });

    res.json({ results });
  } catch (err) {
    next(err);
  }
}

export async function addTrackingEvent(req, res, next) {
  try {
    const { drop_id } = req.params;
    const { event_type, event_label, facility, event_time, metadata } =
      req.body || {};

    if (!drop_id || !event_type || !event_label) {
      return res.status(400).json({
        error: "drop_id, event_type, and event_label are required"
      });
    }

    const event = await createMailTrackingEvent({
      drop_id,
      event_type,
      event_label,
      facility,
      event_time,
      metadata
    });

    res.status(201).json(event);
  } catch (err) {
    next(err);
  }
}

export async function getTrackingEvents(req, res, next) {
  try {
    const results = await listMailTrackingEvents(req.params.drop_id);
    res.json({ results });
  } catch (err) {
    next(err);
  }
}

export async function getDashboard(req, res, next) {
  try {
    const data = await getMailDashboard({
      firm_id: req.query.firm_id || "",
      campaign_id: req.query.campaign_id || ""
    });

    res.json({
      metrics: [
        {
          label: "Mail Programs",
          value: `${data.summary.programs}`,
          delta: "Tracked programs",
          tone: "up"
        },
        {
          label: "Mail Drops",
          value: `${data.summary.drops}`,
          delta: "Tracked drops",
          tone: "up"
        },
        {
          label: "In Transit",
          value: `${data.summary.in_transit}`,
          delta: "USPS movement",
          tone: "alert"
        },
        {
          label: "Delivered",
          value: `${data.summary.delivered}`,
          delta: "Completed delivery",
          tone: "up"
        }
      ],
      ...data
    });
  } catch (err) {
    next(err);
  }
}

export async function getCampaignMail(req, res, next) {
  try {
    const campaignId = Number(req.params.id);
    if (!campaignId) {
      return res.status(400).json({ error: "valid campaign id required" });
    }

    const data = await getCampaignMailWorkspace(campaignId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getProgramDetail(req, res, next) {
  try {
    const program = await getMailProgramById(req.params.program_id);
    if (!program) {
      return res.status(404).json({ error: "mail program not found" });
    }

    const drops = await listMailDrops({ program_id: req.params.program_id });

    res.json({
      program,
      drops
    });
  } catch (err) {
    next(err);
  }
}
