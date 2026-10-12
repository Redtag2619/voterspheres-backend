import { scopeConfig, pageUrl, validatePage, importError } from './fecMoneyProtocol.js';

// Store.commitPage must atomically store records + fingerprint + cursor. A failed
// page never advances the checkpoint, so the same page can be retried safely.
export async function resumeMoneyLane({ store, request, apiKey, config: input, pageBudget = 2, publishBudget = 2, now = () => new Date() }) {
  const config = scopeConfig(input);
  for (const n of [pageBudget, publishBudget]) if (!Number.isInteger(n) || n < 1 || n > 100) throw importError('INVALID_WORK_BUDGET', 400);
  if (!apiKey) throw importError('FEC_KEY_MISSING', 400);
  let state = await store.load(config);
  if (!state || ['completed', 'no_data', 'abandoned'].includes(state.status)) state = await store.start(config, now().toISOString().slice(0, 10));
  try {
    // Offset pagination is mutable. Recheck its first-page anchor before resuming
    // an interrupted Schedule E traversal; drift requires a new preserved sweep.
    if (config.lane === 'political-money' && state.status !== 'publishing' && state.pages > 0) {
      const first = validatePage(config, { ...state, cursor: { page: 1 } }, await request(pageUrl(config, { ...state, cursor: { page: 1 } }, apiKey)));
      if (first.fingerprint !== state.anchor) throw importError('PROVIDER_ANCHOR_CHANGED');
    }
    for (let count = 0; count < pageBudget && state.status !== 'publishing'; count++) {
      const result = validatePage(config, state, await request(pageUrl(config, state, apiKey)));
      state = await store.commitPage(config, state, result);
      if (state.status === 'no_data') return state;
    }
    if (state.status === 'publishing') {
      for (let count = 0; count < publishBudget && state.status === 'publishing'; count++) state = await store.publishChunk(config, state);
    }
    return state;
  } catch (error) {
    await store.fail(config, state, error.code || 'IMPORT_FAILED').catch(() => {});
    throw error;
  }
}
