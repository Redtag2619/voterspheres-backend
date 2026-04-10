import {
  getMailOpsDashboard,
  createMailEvent,
  updateMailEvent,
} from "../services/mailops.service.js";

export async function getDashboard(req, res) {
  try {
    const data = await getMailOpsDashboard(req.user);
    return res.status(200).json(data);
  } catch (error) {
    console.error("MailOps dashboard error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to load MailOps dashboard.",
    });
  }
}

export async function createEvent(req, res) {
  try {
    const event = await createMailEvent(req.user, req.body);
    return res.status(201).json({
      message: "Mail event created successfully.",
      event,
    });
  } catch (error) {
    console.error("MailOps create event error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to create MailOps event.",
    });
  }
}

export async function updateEvent(req, res) {
  try {
    const event = await updateMailEvent(req.user, req.params.id, req.body);
    return res.status(200).json({
      message: "Mail event updated successfully.",
      event,
    });
  } catch (error) {
    console.error("MailOps update event error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to update MailOps event.",
    });
  }
}
