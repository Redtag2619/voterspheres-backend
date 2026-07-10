export function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

export function getUserId(user = {}) {
  return user.id || user.user_id || user.sub || null;
}

export function clean(value = "") {
  return String(value || "")
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<font\b[^>]*>(.*?)<\/font>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function lower(value = "") {
  return String(value || "").toLowerCase();
}

export function includesAny(text, words = []) {
  const value = lower(text);
  return words.some((word) => value.includes(lower(word)));
}

export function truncate(value = "", max = 2200) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

export function normalizeWorkspaceId(value) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : null;
}

export function summarizeTop(items = [], mapper, limit = 5) {
  return items.slice(0, limit).map(mapper).filter(Boolean);
}

export function detectState(prompt = "") {
  return (
    lower(prompt).match(
      /\b(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|ia|id|il|in|ks|ky|la|ma|md|me|mi|mn|mo|ms|mt|nc|nd|ne|nh|nj|nm|nv|ny|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|va|vt|wa|wi|wv|wy|dc)\b/i
    )?.[0]?.toUpperCase() || null
  );
}
