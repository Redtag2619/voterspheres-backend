function parseCsv(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

export function getBetaAccessConfig() {
  return {
    enabled: String(process.env.BETA_ACCESS_ENABLED || "true").toLowerCase() === "true",
    publicSignupEnabled:
      String(process.env.BETA_PUBLIC_SIGNUP_ENABLED || "false").toLowerCase() === "true",
    allowedEmails: parseCsv(process.env.BETA_ALLOWLIST_EMAILS || ""),
    allowedDomains: parseCsv(process.env.BETA_ALLOWLIST_DOMAINS || ""),
    inviteCode: String(process.env.BETA_INVITE_CODE || "").trim(),
    message:
      process.env.BETA_ACCESS_MESSAGE ||
      "VoterSpheres is currently in a private beta. Your email is not yet approved for access."
  };
}

export function isEmailApproved(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const config = getBetaAccessConfig();
  if (!config.enabled) return true;
  if (config.publicSignupEnabled) return true;
  if (config.allowedEmails.includes(normalized)) return true;

  const domain = normalized.split("@")[1] || "";
  if (domain && config.allowedDomains.includes(domain)) return true;

  return false;
}

export function isInviteCodeApproved(inviteCode) {
  const config = getBetaAccessConfig();

  if (!config.enabled) return true;
  if (!config.inviteCode) return false;

  return String(inviteCode || "").trim() === config.inviteCode;
}

export function assertBetaAccess(email, options = {}) {
  const config = getBetaAccessConfig();

  if (!config.enabled) {
    return {
      ok: true
    };
  }

  if (config.publicSignupEnabled) {
    return {
      ok: true
    };
  }

  if (isEmailApproved(email)) {
    return {
      ok: true
    };
  }

  if (options.allowInviteCode && isInviteCodeApproved(options.inviteCode)) {
    return {
      ok: true
    };
  }

  const error = new Error(config.message);
  error.status = 403;
  error.code = "BETA_ACCESS_DENIED";
  throw error;
}
