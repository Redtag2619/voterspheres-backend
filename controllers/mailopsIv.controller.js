import { ivMode, lookupIvPiece, validateIvLookup } from "../services/uspsIvLookup.js";

const ERRORS = {
  INVALID_IV_BARCODE: "Enter a six- or nine-digit Mailer ID and the full numeric IMb.",
  IV_MID_MISMATCH: "The Mailer ID does not match the one embedded in this IMb.",
  INVALID_IV_CREDENTIALS: "Enter your USPS Business Customer Gateway username and password.",
  IV_SIGN_IN_REJECTED: "USPS rejected the sign-in. Check your IV-MTR account and BSA or BSA Delegate access.",
  IV_ACCESS_DENIED: "USPS did not authorize access. Check the account's IV-MTR role and Mailer ID permissions.",
  IV_RATE_LIMITED: "The lookup limit was reached. Wait a minute before trying again.",
  IV_AUTH_UNAVAILABLE: "USPS sign-in is unavailable. Try again later.",
  IV_TRACKING_UNAVAILABLE: "USPS tracking is unavailable for this request. Try again later.",
  IV_UNEXPECTED_RESPONSE: "USPS returned tracking data that could not be verified.",
  IV_NOT_CONFIGURED: "USPS tracking is not enabled on this deployment.",
};

function positiveId(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const id = String(value).trim();
  return /^[1-9][0-9]*$/.test(id) ? id : null;
}

function canUseCat(user, pilot) {
  const pilotUser = positiveId(pilot?.userId);
  const pilotFirm = positiveId(pilot?.firmId);
  return Boolean(pilotUser && pilotFirm &&
    positiveId(user?.id) === pilotUser &&
    positiveId(user?.firm_id) === pilotFirm);
}

export function createIvHandlers({
  getMode = () => ivMode(process.env.USPS_IV_MODE),
  getPilot = () => ({
    userId: process.env.USPS_IV_PILOT_USER_ID,
    firmId: process.env.USPS_IV_PILOT_FIRM_ID,
  }),
  lookup = lookupIvPiece,
  now = Date.now,
} = {}) {
  // This process-local guard limits both repeated logins and bursts across firms.
  let windowStart = -Infinity;
  let total = 0;
  const perFirm = new Map();
  const take = firm => {
    const time = now();
    if (time - windowStart >= 60000) {
      perFirm.clear();
      windowStart = time;
      total = 0;
    }
    const used = perFirm.get(firm) ?? 0;
    if (total >= 60 || used >= 10) return false;
    perFirm.set(firm, used + 1);
    total++;
    return true;
  };
  const noStore = res => res.set("Cache-Control", "no-store");

  const availability = user => {
    const mode = ivMode(getMode());
    const hidden = mode === "cat" && !canUseCat(user, getPilot());
    return { mode: hidden ? null : mode, hidden };
  };

  return {
    status(req, res) {
      noStore(res);
      if (!req.user?.firm_id) return res.status(403).json({ error: "FIRM_REQUIRED" });
      const { mode, hidden } = availability(req.user);
      return res.json({ enabled: Boolean(mode), test_mode: mode === "cat", ...(hidden ? { hidden } : {}) });
    },
    async lookup(req, res) {
      noStore(res);
      const input = req.body;
      req.body = undefined;
      const firm = req.user?.firm_id;
      if (!firm) return res.status(403).json({ error: "FIRM_REQUIRED" });
      const { mode } = availability(req.user);
      if (!mode) return res.status(503).json({ error: "IV_NOT_CONFIGURED", message: ERRORS.IV_NOT_CONFIGURED });
      try {
        validateIvLookup(input);
        if (!take(String(firm))) {
          res.set("Retry-After", "60");
          return res.status(429).json({ error: "IV_RATE_LIMITED", message: ERRORS.IV_RATE_LIMITED });
        }
        const piece = await lookup(input, mode);
        return res.json({ ok: true, piece });
      } catch (error) {
        // Do not log or echo upstream bodies, credentials, barcodes or tokens.
        const code = Object.hasOwn(ERRORS, error?.code) ? error.code : "IV_TRACKING_UNAVAILABLE";
        return res.status(code === error?.code ? error.status : 502).json({ error: code, message: ERRORS[code] });
      }
    },
  };
}

export const mailopsIv = createIvHandlers();
