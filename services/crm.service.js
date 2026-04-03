import {
  ensureCrmTables,
  createFirm, 
  listFirms,
  createUser,
  listUsers,
  createCampaign,
  listCampaigns,
  getCampaignById,
  addCampaignContact,
  addCampaignVendor,
  addCampaignTask,
  addCampaignDocument,
  addCampaignActivity
} from "../repositories/crm.repository.js";

function makeSlug(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function initializeCrm(_req, res, next) {
  try {
    await ensureCrmTables();
    res.json({ ok: true, message: "CRM tables ready" });
  } catch (err) {
    next(err);
  }
}

export async function createFirmHandler(req, res, next) {
  try {
    await ensureCrmTables();

    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const slug = makeSlug(req.body?.slug || name);
    const row = await createFirm({
      name,
      slug,
      website: req.body?.website || null,
      firm_type: req.body?.firm_type || null,
      primary_state: req.body?.primary_state || null,
      description: req.body?.description || null
    });

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

export async function listFirmsHandler(req, res, next) {
  try {
    await ensureCrmTables();
    const rows = await listFirms({
      search: String(req.query.search || "")
    });

    res.json({
      count: rows.length,
      results: rows
    });
  } catch (err) {
    next(err);
  }
}

export async function createUserHandler(req, res, next) {
  try {
    await ensureCrmTables();

    const first_name = String(req.body?.first_name || "").trim();
    const last_name = String(req.body?.last_name || "").trim();
    const email = String(req.body?.email || "").trim();

    if (!first_name || !last_name || !email) {
      return res.status(400).json({
        error: "first_name, last_name, and email are required"
      });
    }

    const row = await createUser({
      firm_id: req.body?.firm_id || null,
      first_name,
      last_name,
      email,
      role: req.body?.role || "member",
      title: req.body?.title || null
    });

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

export async function listUsersHandler(req, res, next) {
  try {
    await ensureCrmTables();

    const rows = await listUsers({
      firm_id: req.query.firm_id ? Number(req.query.firm_id) : null,
      search: String(req.query.search || "")
    });

    res.json({
      count: rows.length,
      results: rows
    });
  } catch (err) {
    next(err);
  }
}

export async function createCampaignHandler(req, res, next) {
  try {
    await ensureCrmTables();

    const candidate_name = String(req.body?.candidate_name || "").trim();
    const campaign_name = String(req.body?.campaign_name || "").trim();

    if (!candidate_name || !campaign_name) {
      return res.status(400).json({
        error: "candidate_name and campaign_name are required"
      });
    }

    const row = await createCampaign({
      firm_id: req.body?.firm_id || null,
      owner_user_id: req.body?.owner_user_id || null,
      candidate_id: req.body?.candidate_id || null,
      candidate_name,
      campaign_name,
      office: req.body?.office || null,
      state: req.body?.state || null,
      county: req.body?.county || null,
      party: req.body?.party || null,
      election_year: req.body?.election_year || null,
      stage: req.body?.stage || "Lead",
      status: req.body?.status || "Open",
      incumbent_status: req.body?.incumbent_status || null,
      website: req.body?.website || null,
      contract_value: req.body?.contract_value || 0,
      budget_total: req.body?.budget_total || 0,
      notes: req.body?.notes || null
    });

    await addCampaignActivity({
      campaign_id: row.id,
      actor_user_id: row.owner_user_id,
      activity_type: "campaign_created",
      summary: `Campaign workspace created for ${row.candidate_name}`,
      metadata: {
        stage: row.stage,
        status: row.status
      }
    });

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

export async function listCampaignsHandler(req, res, next) {
  try {
    await ensureCrmTables();

    const rows = await listCampaigns({
      firm_id: req.query.firm_id ? Number(req.query.firm_id) : null,
      stage: String(req.query.stage || ""),
      state: String(req.query.state || ""),
      search: String(req.query.search || "")
    });

    res.json({
      count: rows.length,
      results: rows
    });
  } catch (err) {
    next(err);
  }
}

export async function getCampaignWorkspaceHandler(req, res, next) {
  try {
    await ensureCrmTables();

    const campaignId = Number(req.params.id);
    if (!campaignId) {
      return res.status(400).json({ error: "valid campaign id required" });
    }

    const row = await getCampaignById(campaignId);
    if (!row) {
      return res.status(404).json({ error: "campaign not found" });
    }

    res.json({
      campaign: row,
      workspace_summary: {
        contacts: row.contacts.length,
        vendors: row.vendors.length,
        tasks_open: row.tasks.filter((t) => t.status !== "done").length,
        tasks_done: row.tasks.filter((t) => t.status === "done").length,
        documents: row.documents.length,
        recent_activity: row.activity.length
      }
    });
  } catch (err) {
    next(err);
  }
}

export async function addCampaignContactHandler(req, res, next) {
  try {
    await ensureCrmTables();

    const campaign_id = Number(req.params.id);
    const full_name = String(req.body?.full_name || "").trim();

    if (!campaign_id || !full_name) {
      return res.status(400).json({ error: "campaign id and full_name are required" });
    }

    const row = await addCampaignContact({
      campaign_id,
      full_name,
      email: req.body?.email || null,
      phone: req.body?.phone || null,
      role: req.body?.role || null,
      organization: req.body?.organization || null,
      notes: req.body?.notes || null
    });

    await addCampaignActivity({
      campaign_id,
      actor_user_id: null,
      activity_type: "contact_added",
      summary: `Contact added: ${row.full_name}`,
      metadata: { role: row.role }
    });

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

export async function addCampaignVendorHandler(req, res, next) {
  try {
    await ensureCrmTables();

    const campaign_id = Number(req.params.id);
    const vendor_name = String(req.body?.vendor_name || "").trim();

    if (!campaign_id || !vendor_name) {
      return res.status(400).json({ error: "campaign id and vendor_name are required" });
    }

    const row = await addCampaignVendor({
      campaign_id,
      vendor_name,
      category: req.body?.category || null,
      status: req.body?.status || "prospect",
      contract_value: req.body?.contract_value || 0,
      notes: req.body?.notes || null
    });

    await addCampaignActivity({
      campaign_id,
      actor_user_id: null,
      activity_type: "vendor_added",
      summary: `Vendor added: ${row.vendor_name}`,
      metadata: { category: row.category, status: row.status }
    });

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

export async function addCampaignTaskHandler(req, res, next) {
  try {
    await ensureCrmTables();

    const campaign_id = Number(req.params.id);
    const title = String(req.body?.title || "").trim();

    if (!campaign_id || !title) {
      return res.status(400).json({ error: "campaign id and title are required" });
    }

    const row = await addCampaignTask({
      campaign_id,
      assigned_user_id: req.body?.assigned_user_id || null,
      title,
      description: req.body?.description || null,
      status: req.body?.status || "todo",
      priority: req.body?.priority || "medium",
      due_date: req.body?.due_date || null
    });

    await addCampaignActivity({
      campaign_id,
      actor_user_id: row.assigned_user_id,
      activity_type: "task_added",
      summary: `Task created: ${row.title}`,
      metadata: {
        priority: row.priority,
        status: row.status
      }
    });

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

export async function addCampaignDocumentHandler(req, res, next) {
  try {
    await ensureCrmTables();

    const campaign_id = Number(req.params.id);
    const name = String(req.body?.name || "").trim();

    if (!campaign_id || !name) {
      return res.status(400).json({ error: "campaign id and name are required" });
    }

    const row = await addCampaignDocument({
      campaign_id,
      name,
      document_type: req.body?.document_type || null,
      file_url: req.body?.file_url || null,
      uploaded_by_user_id: req.body?.uploaded_by_user_id || null
    });

    await addCampaignActivity({
      campaign_id,
      actor_user_id: row.uploaded_by_user_id,
      activity_type: "document_added",
      summary: `Document added: ${row.name}`,
      metadata: { document_type: row.document_type }
    });

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}
