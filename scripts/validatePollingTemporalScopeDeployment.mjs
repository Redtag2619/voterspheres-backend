import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const VALIDATOR_VERSION = "2.6.0";

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, ...rest] = item.slice(2).split("=");
    args[key] = rest.length ? rest.join("=") : true;
  }
  return args;
}

export function normalizeBaseUrl(value) {
  const url = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("--base-url must be an absolute HTTP(S) URL.");
  }
  return url.endsWith("/api") ? url : `${url}/api`;
}

export function publicScopeNames(payload = {}) {
  const scopes = Array.isArray(payload.temporal_scopes)
    ? payload.temporal_scopes
    : Array.isArray(payload.scopes) ? payload.scopes : [];
  return scopes
    .map((scope) => String(scope?.temporal_scope || scope?.value || scope?.scope || scope))
    .filter(Boolean);
}

export function countSnapshot(payload = {}) {
  if (Array.isArray(payload.temporal_scopes)) {
    return Object.fromEntries(payload.temporal_scopes.map((scope) => [
      String(scope.temporal_scope),
      {
        polls: Number(scope.polls || 0),
        answer_rows: Number(scope.answer_rows || 0),
      },
    ]));
  }
  const candidate =
    payload.scope_counts ||
    payload.counts ||
    payload.summary?.scope_counts ||
    payload.summary?.counts ||
    {};
  return JSON.parse(JSON.stringify(candidate));
}

export function stableHash(value) {
  const canonical = JSON.stringify(sortValue(value));
  return createHash("sha256").update(canonical).digest("hex");
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortValue(value[key])])
    );
  }
  return value;
}

async function requestJson(url, { token, expectedStatus, label }) {
  const response = await fetch(url, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    redirect: "manual",
  });
  let body = null;
  const text = await response.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = { text: text.slice(0, 500) }; }
  }
  const passed = Array.isArray(expectedStatus)
    ? expectedStatus.includes(response.status)
    : response.status === expectedStatus;
  return { label, url, status: response.status, expected_status: expectedStatus, passed, body };
}

export async function runValidation({ baseUrl, userToken, operatorToken = "" }) {
  if (!userToken) throw new Error("A user token is required via --user-token or PHASE_2_6_USER_TOKEN.");
  const api = normalizeBaseUrl(baseUrl);
  const root = `${api}/executive-polling-intelligence`;
  const checks = [];

  checks.push(await requestJson(`${api}/health`, {
    expectedStatus: 200,
    label: "API health",
  }));
  checks.push(await requestJson(`${root}/scopes`, {
    expectedStatus: [401, 403],
    label: "Scopes reject anonymous access",
  }));

  const before = await requestJson(`${root}/scopes`, {
    token: userToken,
    expectedStatus: 200,
    label: "User scope discovery",
  });
  checks.push(before);

  const userScopes = publicScopeNames(before.body);
  checks.push({
    label: "User receives only public scopes",
    passed:
      userScopes.includes("election_cycle") &&
      userScopes.includes("continuous_tracking") &&
      !userScopes.includes("unresolved") &&
      !userScopes.includes("all"),
    observed: userScopes,
  });

  const userMatrix = [
    ["dashboard defaults to election cycle", `${root}/dashboard`, 200],
    ["explicit election cycle", `${root}/dashboard?temporal_scope=election_cycle&cycle=2026`, 200],
    ["continuous tracking", `${root}/dashboard?temporal_scope=continuous_tracking`, 200],
    ["continuous scope rejects cycle", `${root}/dashboard?temporal_scope=continuous_tracking&cycle=2026`, 400],
    ["user cannot read unresolved", `${root}/dashboard?temporal_scope=unresolved`, 403],
    ["user cannot read combined scope", `${root}/dashboard?temporal_scope=all`, 403],
    ["records election scope", `${root}/records?temporal_scope=election_cycle&cycle=2026&limit=5`, 200],
    ["records continuous scope", `${root}/records?temporal_scope=continuous_tracking&limit=5`, 200],
  ];
  for (const [label, url, expectedStatus] of userMatrix) {
    checks.push(await requestJson(url, { token: userToken, expectedStatus, label }));
  }

  if (operatorToken) {
    const operatorScopes = await requestJson(`${root}/scopes`, {
      token: operatorToken,
      expectedStatus: 200,
      label: "Operator scope discovery",
    });
    checks.push(operatorScopes);
    const names = publicScopeNames(operatorScopes.body);
    checks.push({
      label: "Operator receives protected scopes",
      passed: names.includes("unresolved"),
      observed: names,
    });
    checks.push(await requestJson(`${root}/dashboard?temporal_scope=unresolved`, {
      token: operatorToken,
      expectedStatus: 200,
      label: "Operator can read unresolved scope",
    }));
    checks.push(await requestJson(`${root}/dashboard?temporal_scope=all`, {
      token: operatorToken,
      expectedStatus: 200,
      label: "Operator can read combined scope",
    }));
  }

  const after = await requestJson(`${root}/scopes`, {
    token: userToken,
    expectedStatus: 200,
    label: "Post-validation scope discovery",
  });
  checks.push(after);
  const beforeCounts = countSnapshot(before.body);
  const afterCounts = countSnapshot(after.body);
  const beforeHash = stableHash(beforeCounts);
  const afterHash = stableHash(afterCounts);
  checks.push({
    label: "Polling scope counts unchanged",
    passed: beforeHash === afterHash,
    before_sha256: beforeHash,
    after_sha256: afterHash,
    before: beforeCounts,
    after: afterCounts,
  });

  return {
    phase: "2.6",
    validator_version: VALIDATOR_VERSION,
    generated_at: new Date().toISOString(),
    mode: "read_only",
    base_url: api,
    operator_checks_run: Boolean(operatorToken),
    passed: checks.every((check) => check.passed),
    checks: checks.map(({ body, ...check }) => ({
      ...check,
      ...(body === null ? {} : { response: body }),
    })),
  };
}

async function main() {
  const args = parseArgs();
  const report = await runValidation({
    baseUrl: args["base-url"] || process.env.PHASE_2_6_BASE_URL,
    userToken: args["user-token"] || process.env.PHASE_2_6_USER_TOKEN,
    operatorToken: args["operator-token"] || process.env.PHASE_2_6_OPERATOR_TOKEN || "",
  });
  const outputDirectory = path.resolve(String(args.output || "./diagnostics/phase-2-6"));
  fs.mkdirSync(outputDirectory, { recursive: true });
  const stamp = report.generated_at.replace(/[:.]/g, "-");
  const outputPath = path.join(outputDirectory, `phase-2-6-production-validation-${stamp}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    phase: report.phase,
    passed: report.passed,
    checks: report.checks.length,
    failed: report.checks.filter((check) => !check.passed).map((check) => check.label),
    output_path: outputPath,
    policy: "Read-only validation; no polling records were changed.",
  }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
