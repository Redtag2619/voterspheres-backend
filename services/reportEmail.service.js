import nodemailer from "nodemailer";

function text(value = "") {
  return String(value ?? "").trim();
}

function providerName() {
  return text(process.env.EMAIL_PROVIDER || "smtp").toLowerCase();
}

function fromAddress() {
  return (
    text(process.env.EMAIL_FROM) ||
    text(process.env.SMTP_FROM) ||
    text(process.env.REPORTS_EMAIL_FROM)
  );
}

function htmlToText(html = "") {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEmailList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);

  return String(value || "")
    .split(",")
    .map(text)
    .filter(Boolean);
}

function buildAttachment({ filename, html }) {
  const safeFilename = filename || `voterspheres-report-${Date.now()}.html`;

  return {
    filename: safeFilename.endsWith(".html") ? safeFilename : `${safeFilename}.html`,
    content: String(html || ""),
    contentType: "text/html"
  };
}

function buildBase64Attachment({ filename, html }) {
  const attachment = buildAttachment({ filename, html });

  return {
    filename: attachment.filename,
    content: Buffer.from(String(html || ""), "utf8").toString("base64"),
    type: "text/html",
    disposition: "attachment"
  };
}

async function sendWithSmtp({ to, subject, html, textBody, filename }) {
  const host = text(process.env.SMTP_HOST);
  const port = Number(process.env.SMTP_PORT || 587);
  const user = text(process.env.SMTP_USER);
  const pass = text(process.env.SMTP_PASS);
  const from = fromAddress();

  if (!host) throw new Error("Missing SMTP_HOST");
  if (!port) throw new Error("Missing SMTP_PORT");
  if (!from) throw new Error("Missing EMAIL_FROM or SMTP_FROM");

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465 || String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: user && pass ? { user, pass } : undefined,
    tls: {
      rejectUnauthorized: String(process.env.SMTP_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false"
    }
  });

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text: textBody || htmlToText(html),
    html,
    attachments: [buildAttachment({ filename, html })]
  });

  return {
    provider: "smtp",
    provider_message_id: info?.messageId || null,
    raw: {
      accepted: info?.accepted || [],
      rejected: info?.rejected || [],
      response: info?.response || null
    }
  };
}

async function sendWithResend({ to, subject, html, textBody, filename }) {
  const apiKey = text(process.env.RESEND_API_KEY);
  const from = fromAddress();

  if (!apiKey) throw new Error("Missing RESEND_API_KEY");
  if (!from) throw new Error("Missing EMAIL_FROM");

  const attachment = buildBase64Attachment({ filename, html });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text: textBody || htmlToText(html),
      attachments: [
        {
          filename: attachment.filename,
          content: attachment.content
        }
      ]
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Resend failed: ${response.status}`);
  }

  return {
    provider: "resend",
    provider_message_id: data?.id || null,
    raw: data
  };
}

async function sendWithSendGrid({ to, subject, html, textBody, filename }) {
  const apiKey = text(process.env.SENDGRID_API_KEY);
  const from = fromAddress();

  if (!apiKey) throw new Error("Missing SENDGRID_API_KEY");
  if (!from) throw new Error("Missing EMAIL_FROM");

  const attachment = buildBase64Attachment({ filename, html });

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: to.map((email) => ({ email })),
          subject
        }
      ],
      from: { email: from },
      content: [
        {
          type: "text/plain",
          value: textBody || htmlToText(html)
        },
        {
          type: "text/html",
          value: html
        }
      ],
      attachments: [
        {
          content: attachment.content,
          filename: attachment.filename,
          type: attachment.type,
          disposition: attachment.disposition
        }
      ]
    })
  });

  const body = await response.text().catch(() => "");
  let data = {};

  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    data = { body };
  }

  if (!response.ok) {
    throw new Error(
      data?.errors?.[0]?.message ||
        data?.message ||
        `SendGrid failed: ${response.status}`
    );
  }

  return {
    provider: "sendgrid",
    provider_message_id: response.headers.get("x-message-id") || null,
    raw: data
  };
}

export async function sendWorkspaceReportEmail({
  to,
  subject,
  html,
  textBody,
  filename
}) {
  const recipients = normalizeEmailList(to);

  if (!recipients.length) {
    throw new Error("At least one recipient email is required");
  }

  if (!subject) {
    throw new Error("Email subject is required");
  }

  if (!html) {
    throw new Error("Report HTML is required");
  }

  const provider = providerName();

  if (provider === "resend") {
    return sendWithResend({
      to: recipients,
      subject,
      html,
      textBody,
      filename
    });
  }

  if (provider === "sendgrid") {
    return sendWithSendGrid({
      to: recipients,
      subject,
      html,
      textBody,
      filename
    });
  }

  return sendWithSmtp({
    to: recipients,
    subject,
    html,
    textBody,
    filename
  });
}

export default sendWorkspaceReportEmail;
