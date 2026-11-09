const ENDPOINTS = Object.freeze({
  cat: {
    auth: "https://cat-services.usps.com/oauth/authenticate",
    base: "https://qiv.usps.com/ivws_api/informedvisapi",
  },
  production: {
    auth: "https://services.usps.com/oauth/authenticate",
    base: "https://iv.usps.com/ivws_api/informedvisapi",
  },
});

// Published application identifier from the IV-MTR Developer Toolkit.
const CLIENT_ID = "687b8a36-db61-42f7-83f7-11c79bf7785e";
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const field = (value, max = 160) => typeof value === "string" ? value.slice(0, max) : null;

export function ivMode(value) {
  return value === "cat" || value === "production" ? value : null;
}

export function validateIvLookup(body = {}) {
  const { mid, imb, username, password } = body ?? {};
  if (typeof mid !== "string" || !/^(?:[0-8]\d{5}|9\d{8})$/.test(mid) ||
      typeof imb !== "string" || !/^(?:\d{20}|\d{25}|\d{29}|\d{31})$/.test(imb)) {
    throw fail(400, "INVALID_IV_BARCODE");
  }
  if (imb.slice(5, 5 + mid.length) !== mid) throw fail(400, "IV_MID_MISMATCH");
  if (typeof username !== "string" || !username.trim() || username.length > 256 ||
      typeof password !== "string" || !password.length || password.length > 512) {
    throw fail(400, "INVALID_IV_CREDENTIALS");
  }
  return { imb, username: username.trim(), password };
}

async function providerJson(fetcher, url, options) {
  const response = await fetcher(url, {
    ...options, redirect: "error", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return { status: response.status, data: null };
  return { status: response.status, data: await response.json() };
}

function projectPiece(data, imb) {
  if (data.imb !== imb || (data.scans != null && !Array.isArray(data.scans))) {
    throw fail(502, "IV_UNEXPECTED_RESPONSE");
  }
  const scans = data.scans ?? [];
  const events = scans
    .filter(scan => typeof scan?.scan_date_time === "string" && typeof scan.scan_event_code === "string")
    .map(scan => ({
      time: field(scan.scan_date_time, 40),
      code: field(scan.scan_event_code, 16),
      type: field(scan.handling_event_type, 32),
      phase: field(scan.mail_phase),
      facility: field(scan.scan_facility_name),
      city: field(scan.scan_facility_city),
      state: field(scan.scan_facility_state, 16),
    }))
    .sort((a, b) => b.time.localeCompare(a.time));
  if (events.length !== scans.length) throw fail(502, "IV_UNEXPECTED_RESPONSE");
  return {
    mail_class: field(data.mail_class),
    mail_shape: field(data.mail_shape),
    estimated_delivery_date: field(data.expected_delivery_date ?? data.anticipated_delivery_date, 32),
    scans: events.slice(0, 100),
    total_scans: events.length,
  };
}

export async function lookupIvPiece(input, mode, fetcher = fetch) {
  const target = ENDPOINTS[ivMode(mode)];
  if (!target) throw fail(503, "IV_NOT_CONFIGURED");
  const { imb, username, password } = validateIvLookup(input);

  const auth = await providerJson(fetcher, target.auth, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      username, password, grant_type: "authorization", response_type: "token",
      scope: "user.info.ereg,iv1.apis", client_id: CLIENT_ID,
    }),
  });
  if ([400, 401, 403].includes(auth.status)) throw fail(403, "IV_SIGN_IN_REJECTED");
  if (auth.status === 429) throw fail(429, "IV_RATE_LIMITED");
  const token = auth.data?.access_token;
  if (typeof token !== "string" || !token || token.length > 8192) {
    throw fail(502, "IV_AUTH_UNAVAILABLE");
  }

  const tracking = await providerJson(fetcher, `${target.base}/api/mt/get/piece/imb/${imb}`, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if ([401, 403].includes(tracking.status)) throw fail(403, "IV_ACCESS_DENIED");
  if (tracking.status === 429) throw fail(429, "IV_RATE_LIMITED");
  if (!tracking.data || !Object.hasOwn(tracking.data, "data")) {
    throw fail(502, "IV_TRACKING_UNAVAILABLE");
  }
  if (tracking.data.message != null) {
    if (/not authorized|unauthorized|access denied/i.test(String(tracking.data.message))) {
      throw fail(403, "IV_ACCESS_DENIED");
    }
    throw fail(502, "IV_TRACKING_UNAVAILABLE");
  }
  return tracking.data.data == null ? null : projectPiece(tracking.data.data, imb);
}
