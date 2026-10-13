// Recognize only the observed Schedule A/B unavailable-period contract.
// Raw provider messages, URLs and keys never leave this classifier.
export async function classifyFecPeriodResponse(response, requestUrl) {
  if (response.status !== 404) return null;
  const url = new URL(String(requestUrl));
  if (url.origin !== 'https://api.open.fec.gov' ||
      !/^\/v1\/schedules\/schedule_[ab]\/$/.test(url.pathname)) return null;
  const period = url.searchParams.get('two_year_transaction_period');
  if (!/^\d{4}$/.test(period || '')) return null;
  let data;
  try {
    const body = await response.text();
    if (body.length > 4096) return null;
    data = JSON.parse(body);
  } catch { return null; }
  if (data.status !== 404 || typeof data.message !== 'string') return null;
  const match = data.message.match(/^two_year_transaction_period not found\. Data exists for two_year_transaction_periods between (\d{4}) and (\d{4})\.$/);
  if (!match) return null;
  const min = Number(match[1]), max = Number(match[2]), requested = Number(period);
  if (min > max || requested <= max || requested % 2 !== 0) return null;
  return { code: 'FEC_PERIOD_NOT_AVAILABLE', availablePeriodMin: min,
    availablePeriodMax: max, requestedPeriod: requested };
}
