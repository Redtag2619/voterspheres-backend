import { createHash } from "node:crypto";
export const error = (code, status = 400) => Object.assign(new Error(code), { code, status });
export const hash = value => createHash("sha256").update(value).digest("hex");
export const LIMITS = Object.freeze({ rows: 5000, bytes: 1000000, campaigns: 100, pieces: 100000, events: 250000, batches: 5000, total_pieces: 200000, total_events: 500000, total_batches: 20000, total_campaigns: 500 });
export function requireCampaignId(id) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw error("INVALID_CAMPAIGN");
  return id;
}
export function barcode(value) {
  if (typeof value !== "string" || !/^(?:[0-9]{20}|[0-9]{25}|[0-9]{29}|[0-9]{31})$/.test(value)) throw error("INVALID_IMB");
  return value;
}
function dateOnly(value) {
  if (typeof value !== "string" || !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(value) ||
      !Number.isFinite(new Date(value+"T00:00:00Z").getTime()) ||
      new Date(value + "T00:00:00Z").toISOString().slice(0,10) !== value) throw error("INVALID_MAILING_DATE");
  return value;
}
export function campaignInput(body = {}) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 120) throw error("INVALID_CAMPAIGN_NAME");
  return { name, mailing_date: dateOnly(body.mailing_date) };
}
export function csvRows(csv) {
  if (typeof csv !== "string" || Buffer.byteLength(csv) > LIMITS.bytes || !csv.trim()) throw error("INVALID_OR_OVERSIZED_CSV");
  const rows = []; let row = [], value = "", quoted = false, closed = false;
  const cell = () => { row.push(value); value = ""; closed = false; };
  const line = () => {
    cell();
    if (row.some(v => v.trim())) rows.push(row);
    row = [];
    if (rows.length > LIMITS.rows + 1) throw error("CSV_ROW_LIMIT");
  };
  csv = csv.replace(/^\uFEFF/, "");
  for (let i=0;i<csv.length;i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i+1] === '"') { value += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else value += ch;
    } else if (ch === '"' && !value && !closed) quoted = true;
    else if (ch === ",") cell();
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && csv[i+1] === "\n") i++; line(); }
    else if (closed || ch === '"') throw error("MALFORMED_CSV");
    else value += ch;
  }
  if (quoted) throw error("MALFORMED_CSV");
  if (value || row.length || closed) line();
  if (rows.length < 2) throw error("EMPTY_CSV");
  const headers = rows.shift().map(s => s.trim());
  if (new Set(headers).size !== headers.length) throw error("DUPLICATE_CSV_HEADER");
  if (rows.some(r => r.length !== headers.length)) throw error("CSV_COLUMN_MISMATCH");
  return { headers, rows };
}
function mappedRows(csv, required, optional = []) {
  const {headers, rows} = csvRows(csv);
  if (required.some(name => !headers.includes(name)) || headers.some(name => ![...required, ...optional].includes(name))) throw error("UNSUPPORTED_CSV_HEADERS");
  return rows.map(row => Object.fromEntries(headers.map((name, i) => [name, row[i].trim()])));
}
export function parseManifest(csv) {
  const seen = new Set();
  const rows = mappedRows(csv, ["imb"], ["sequence"]).map(r => {
    const imb = barcode(r.imb);
    if (seen.has(imb)) throw error("DUPLICATE_MANIFEST_IMB");
    seen.add(imb);
    if ((r.sequence ?? "").length > 80) throw error("INVALID_SEQUENCE");
    return { imb, sequence: r.sequence ?? "" };
  });
  return { rows, plan: hash(JSON.stringify(rows)) };
}
export function parseFeed(csv) {
  const rows = mappedRows(csv, ["IMb","Scan Date Time","Scan Event Code"], ["Handling Event Type","Handling Event Type Description","Scan Facility Name","Scan Facility ZIP"]);
  const events = rows.map(r => {
    const imb = barcode(r.IMb);
    const event_time = r["Scan Date Time"];
    if (!/^20\d{2}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?$/.test(event_time)) throw error("INVALID_FEED_TIME");
    // USPS timestamps may be local. Preserve their text; do not invent a time zone.
    const offset = event_time.match(/([+-])([0-9]{2}):?([0-9]{2})$/);
    if (offset && (Number(offset[2])>14 || Number(offset[3])>59 ||
        (Number(offset[2])===14 && Number(offset[3])!==0))) throw error("INVALID_FEED_TIME");
    const prefix = event_time.slice(0,19).replace(" ", "T");
    const parsed = new Date(prefix + "Z");
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,19) !== prefix) throw error("INVALID_FEED_TIME");
    const code = r["Scan Event Code"];
    if (!/^[0-9]{1,8}$/.test(code)) throw error("INVALID_EVENT_CODE");
    const sourceType = r["Handling Event Type Description"] ?? r["Handling Event Type"];
    const event_type = sourceType === "A" ? "Actual" : sourceType;
    if (!["Actual","Assumed Actual","Assumed Logical","Logical"].includes(event_type)) throw error("UNSUPPORTED_EVENT_TYPE");
    const facility = r["Scan Facility Name"] ?? "", facility_zip = r["Scan Facility ZIP"] ?? "";
    if (facility.length > 160 || facility_zip.length > 16) throw error("INVALID_FACILITY");
    const event = { imb, event_time, event_code: code, event_type, facility, facility_zip };
    return { ...event, event_key: hash(JSON.stringify(event)) };
  });
  return { rows: events, file_hash: hash(csv) };
}
