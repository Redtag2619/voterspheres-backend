export function financeElectionCycle(value, fallback = process.env.FEC_DEFAULT_CYCLE || 2026) {
  if (value != null && !['string','number'].includes(typeof value)) throw invalidCycle();
  const candidate = value == null || String(value).trim() === '' ? fallback : value;
 if (!/^\d{4}$/.test(String(candidate).trim())) throw invalidCycle();
 const year = Number(candidate);
 if (year < 2000 || year > 2200 || year % 2 !== 0) throw invalidCycle();
 return year;
}
function invalidCycle() {
 return Object.assign(new Error('cycle must be an even year between 2000 and 2200.'), {statusCode:400, code:'INVALID_ELECTION_CYCLE'});
}
