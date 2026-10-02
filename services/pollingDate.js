// Keep polling calendar dates independent of display locale and timezone.
export function pollingDateKey(value) {
 if (value == null || value === '') return null;
 const raw=String(value).trim();
 const iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
 if (iso) {
  const y=Number(iso[1]),m=Number(iso[2]),d=Number(iso[3]);
  const check=new Date(Date.UTC(y,m-1,d));
  return check.getUTCFullYear()===y && check.getUTCMonth()===m-1 && check.getUTCDate()===d ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
 }
 if (!(value instanceof Date) && !/^[A-Za-z]{3} [A-Za-z]{3} \d{1,2} \d{4} /.test(raw)) return null;
 const date=value instanceof Date ? value : new Date(raw);
 if (!Number.isFinite(date.getTime())) return null;
 return date.toISOString().slice(0,10);
}
export function comparePollingDates(a,b) {
 return (pollingDateKey(b.poll_date)||pollingDateKey(b.end_date)||'').localeCompare(pollingDateKey(a.poll_date)||pollingDateKey(a.end_date)||'');
}
