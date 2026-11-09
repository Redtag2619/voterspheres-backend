import test from "node:test";
import assert from "node:assert/strict";
import { lookupIvPiece, validateIvLookup } from "../services/uspsIvLookup.js";
import { createIvHandlers } from "../controllers/mailopsIv.controller.js";

const input = { mid: "012345", imb: "00243" + "012345" + "123456789" + "76603218391", username: "fixture-user", password: "fixture-password" };
const piece = { imb: input.imb, scans: [
  { scan_event_code: "898", scan_date_time: "2026-11-01T10:00:00", handling_event_type: "A", device_id: "omitted" },
  { scan_event_code: "901", scan_date_time: "2026-11-02T10:00:00", handling_event_type: "Logical" },
], edoc_submitter_crid: "omitted" };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test("validates numeric barcode, MID match and credentials before a provider call", async () => {
  let calls = 0;
  const mock = () => { calls++; };
  await assert.rejects(lookupIvPiece({ ...input, mid: "123456" }, "cat", mock), { code: "IV_MID_MISMATCH" });
  await assert.rejects(lookupIvPiece({ ...input, imb: input.imb + "/etc" }, "cat", mock), { code: "INVALID_IV_BARCODE" });
  await assert.rejects(lookupIvPiece({ ...input, password: "" }, "cat", mock), { code: "INVALID_IV_CREDENTIALS" });
  assert.equal(calls, 0);
  assert.equal(validateIvLookup({ ...input, mid: "900123456", imb: "00243900123456123456" }).imb.length, 20);
});

test("each lookup authenticates independently; only allowlisted scan fields are returned", async () => {
  const calls = [];
  const mock = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "POST") return response({ access_token: JSON.parse(options.body).username });
    return response({ data: piece, message: null });
  };
  const results = await Promise.all([
    lookupIvPiece(input, "cat", mock),
    lookupIvPiece({ ...input, username: "another-firm" }, "cat", mock),
  ]);
  const scans = calls.filter(x => x.options.method === "GET");
  assert.equal(scans.length, 2);
  assert.deepEqual(scans.map(x => x.options.headers.Authorization).sort(), ["Bearer another-firm", "Bearer fixture-user"]);
  assert.ok(scans.every(x => x.url === `https://qiv.usps.com/ivws_api/informedvisapi/api/mt/get/piece/imb/${input.imb}`));
  assert.ok(calls.every(x => x.options.redirect === "error"));
  assert.equal(results[0].scans[0].type, "Logical");
  assert.doesNotMatch(JSON.stringify(results), /fixture|another-firm|omitted|012345/);
});

test("distinguishes authorization, empty responses, and unexpected barcode data", async () => {
  const mock = tracking => async (_url, options) =>
    options.method === "POST" ? response({ access_token: "token" }) : tracking;
  await assert.rejects(lookupIvPiece(input, "cat", mock(response({ message: "User is not authorized to view data", data: null }))), { code: "IV_ACCESS_DENIED" });
  assert.equal(await lookupIvPiece(input, "cat", mock(response({ message: null, data: null }))), null);
  await assert.rejects(lookupIvPiece(input, "cat", mock(response({ message: null, data: { ...piece, imb: "other" } }))), { code: "IV_UNEXPECTED_RESPONSE" });
});

async function invoke(handlers, firm, data = input, { userId, method = "lookup" } = {}) {
  const req = { user: firm ? { firm_id: firm, id: userId } : null, body: data };
  const out = { statusCode: 200, headers: {} };
  const res = {
    status(code) { out.statusCode = code; return this; },
    set(key, value) { out.headers[key] = value; return this; },
    json(value) { out.body = value; return this; },
  };
  await handlers[method](req, res);
  return { ...out, req };
}

test("controller fails closed, rate limits by authenticated firm, and scrubs upstream errors", async () => {
  let mode = null;
  let time = 1;
  let calls = 0;
  const handlers = createIvHandlers({
    getMode: () => mode,
    now: () => time,
    lookup: async () => { calls++; throw new Error("fixture-password and bearer token"); },
  });
  assert.equal((await invoke(handlers, null, { ...input, firm_id: 7 })).statusCode, 403);
  assert.equal((await invoke(handlers, 7)).statusCode, 503);
  assert.equal(calls, 0);
  mode = "production";
  for (let index = 0; index < 10; index++) {
    const result = await invoke(handlers, 7, { ...input, firm_id: 8 });
    assert.equal(result.statusCode, 502);
    assert.equal(result.headers["Cache-Control"], "no-store");
    assert.equal(result.req.body, undefined);
    assert.doesNotMatch(JSON.stringify(result.body), /fixture-password|bearer token/);
  }
  assert.equal((await invoke(handlers, 7)).statusCode, 429);
  assert.equal((await invoke(handlers, 8)).statusCode, 502);
  time += 60000;
  assert.equal((await invoke(handlers, 7)).statusCode, 502);
  assert.equal(calls, 12);
});

test("CAT status and lookup fail closed unless both authenticated IDs match the private pilot", async () => {
  let pilot = {};
  let calls = 0;
  const handlers = createIvHandlers({
    getMode: () => "cat",
    getPilot: () => pilot,
    lookup: async (_, mode) => {
      assert.equal(mode, "cat");
      calls++;
      return null;
    },
  });
  const status = (firm, userId) => invoke(handlers, firm, undefined, { userId, method: "status" });
  const lookup = (firm, userId) =>
    invoke(handlers, firm, { ...input, id: 42, user_id: 42, firm_id: 7 }, { userId });
  const denied = { enabled: false, test_mode: false, hidden: true };
  assert.equal((await status(null, 42)).statusCode, 403);
  for (const config of [{}, { userId: "42" }, { firmId: "7" }, { userId: "*", firmId: "7" }]) {
    pilot = config;
    assert.deepEqual((await status(7, 42)).body, denied);
    assert.equal((await lookup(7, 42)).statusCode, 503);
  }
  pilot = { userId: "42", firmId: "7" };
  for (const [firm, userId] of [[7, 43], [8, 42], [8, 43], [7, undefined]]) {
    assert.deepEqual((await status(firm, userId)).body, denied);
    assert.equal((await lookup(firm, userId)).statusCode, 503);
  }
  assert.equal(calls, 0);
  const available = await status(7, 42);
  assert.deepEqual(available.body, { enabled: true, test_mode: true });
  assert.equal(available.headers["Cache-Control"], "no-store");
  assert.equal((await lookup(7, 42)).statusCode, 200);
  assert.equal(calls, 1);
});

test("normal production tracking mode does not use the CAT pilot IDs", async () => {
  const handlers = createIvHandlers({
    getMode: () => "production",
    getPilot: () => { throw new Error("CAT configuration must not be read"); },
    lookup: async (_, mode) => { assert.equal(mode, "production"); return null; },
  });
  assert.deepEqual((await invoke(handlers, 8, undefined, { userId: 43, method: "status" })).body,
    { enabled: true, test_mode: false });
  assert.equal((await invoke(handlers, 8, input, { userId: 43 })).statusCode, 200);
});
