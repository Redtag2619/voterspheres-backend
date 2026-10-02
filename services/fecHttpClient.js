// Requests are serialized within this process; other workers share the provider quota.
export function createFecHttpClient({ fetchImpl = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, intervalMs = 4000, timeoutMs = 30000, retries = 3, maxDelayMs = 60000 } = {}) {
  for (const [name, value] of Object.entries({ intervalMs, timeoutMs, retries, maxDelayMs })) {
    if (!Number.isFinite(value) || value < 0 || (name === 'retries' && !Number.isInteger(value)) || (name === 'timeoutMs' && value === 0)) throw new Error(`Invalid FEC ${name}`);
  }
  let tail = Promise.resolve(), lastStart = null;
  async function request(url) {
    for (let attempt = 0; ; attempt++) {
      if (lastStart !== null) await sleep(Math.max(0, intervalMs - (now() - lastStart)));
      lastStart = now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response, payload, networkFailure = false;
      try {
        response = await fetchImpl(String(url), { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'VoterSpheres/1.0' }, signal: controller.signal });
        if (response.ok) payload = await response.json();
        else await response.body?.cancel();
      } catch { networkFailure = true; }
      finally { clearTimeout(timer); }
      if (response?.ok && !networkFailure) return payload;
      const status = response?.status || 0;
      const retryable = networkFailure || [429, 500, 502, 503, 504].includes(status);
      const failure = () => Object.assign(new Error(status ? `FEC API request failed (${status}); credentials and provider body omitted.` : 'FEC API request failed or timed out; credentials omitted.'), { statusCode: 502, providerStatus: status, code: status === 429 ? 'FEC_RATE_LIMIT' : 'FEC_REQUEST_FAILED', attempts: attempt + 1 });
      if (!retryable || attempt >= retries) throw failure();
      const header = response?.headers?.get('retry-after');
      let delay = 1000 * 2 ** attempt;
      if (header !== null && header !== undefined) {
        const seconds = Number(header);
        const requested = String(header).trim() !== '' && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now();
        if (Number.isFinite(requested)) delay = Math.max(delay, requested, 0);
      }
      // Never retry earlier than an explicit Retry-After longer than our bounded wait.
      if (delay > maxDelayMs) throw failure();
      await sleep(delay);
    }
  }
  return url => {
    const next = tail.then(() => request(url));
    tail = next.catch(() => {});
    return next;
  };
}
