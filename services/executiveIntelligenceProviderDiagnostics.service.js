const DEFAULT_TIMEOUT_MS = 12000;

function nowIso() {
  return new Date().toISOString();
}

function cleanError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || "Unknown provider error",
    code: error?.code || error?.cause?.code || null,
    status: error?.status || error?.response?.status || null,
  };
}

export function createProviderDiagnostics() {
  const startedAt = Date.now();
  const providers = [];

  return {
    started_at: new Date(startedAt).toISOString(),
    providers,

    record(entry = {}) {
      providers.push({
        provider: entry.provider || "unknown",
        tool: entry.tool || entry.provider || "unknown",
        ok: Boolean(entry.ok),
        status: entry.status || (entry.ok ? "success" : "failed"),
        duration_ms: Number(entry.duration_ms || 0),
        evidence_count: Number(entry.evidence_count || 0),
        error: entry.error || null,
        metadata: entry.metadata || {},
        completed_at: nowIso(),
      });
    },

    summarize() {
      const successful = providers.filter((item) => item.ok);
      const failed = providers.filter((item) => !item.ok);
      const evidenceCount = providers.reduce(
        (total, item) => total + Number(item.evidence_count || 0),
        0
      );

      return {
        started_at: new Date(startedAt).toISOString(),
        completed_at: nowIso(),
        duration_ms: Date.now() - startedAt,
        provider_count: providers.length,
        successful_provider_count: successful.length,
        failed_provider_count: failed.length,
        evidence_count: evidenceCount,
        health:
          successful.length === 0
            ? "unavailable"
            : failed.length === 0
              ? "healthy"
              : "degraded",
        providers,
      };
    },
  };
}

export async function runProviderWithDiagnostics({
  diagnostics,
  provider,
  tool,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  execute,
}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await execute({ signal: controller.signal });
    const evidenceCount = Array.isArray(result)
      ? result.length
      : Array.isArray(result?.evidence)
        ? result.evidence.length
        : Array.isArray(result?.items)
          ? result.items.length
          : result
            ? 1
            : 0;

    diagnostics?.record({
      provider,
      tool,
      ok: true,
      duration_ms: Date.now() - startedAt,
      evidence_count: evidenceCount,
    });

    return { ok: true, result, error: null };
  } catch (error) {
    const normalizedError =
      error?.name === "AbortError"
        ? {
            name: "TimeoutError",
            message: `${provider || tool} exceeded ${timeoutMs}ms`,
            code: "PROVIDER_TIMEOUT",
            status: 504,
          }
        : cleanError(error);

    diagnostics?.record({
      provider,
      tool,
      ok: false,
      status: normalizedError.code === "PROVIDER_TIMEOUT" ? "timeout" : "failed",
      duration_ms: Date.now() - startedAt,
      evidence_count: 0,
      error: normalizedError,
    });

    return { ok: false, result: null, error: normalizedError };
  } finally {
    clearTimeout(timeout);
  }
}
