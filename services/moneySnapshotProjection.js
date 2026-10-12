import { importError } from './fecMoneyProtocol.js';
const text = value => String(value ?? '').trim();
export function vendorProjection(row, cycle) {
  const name = text(row.recipient_name || row.payee_name);
  if (!name) throw importError('MISSING_PAYEE_NAME');
  const purpose = text(row.disbursement_description || row.memo_text);
  const haystack = `${purpose} ${name}`.toLowerCase();
  const category = /(mail|postage|print|postcard|letter)/.test(haystack) ? 'Direct Mail'
    : /(media|advertising|tv|radio|broadcast|digital)/.test(haystack) ? 'Media / Advertising'
    : /(consult|strategy|field|poll|survey|research)/.test(haystack) ? 'Consulting / Strategy'
    : /(software|data|technology|hosting|website|crm)/.test(haystack) ? 'Data / Technology'
    : /(fundrais|finance|compliance|accounting|legal)/.test(haystack) ? 'Fundraising / Compliance'
    : /(event|venue|catering|travel|hotel|airline)/.test(haystack) ? 'Events / Travel' : 'Campaign Operations';
  return { cycle, source: 'fec_schedule_b', vendor_name: name, payee_name: name,
    committee_id: row.committee_id, committee_name: text(row.committee?.name || row.committee_name || row.committee_id),
    state: text(row.recipient_state || row.payee_state).toUpperCase(), payee_state: text(row.recipient_state || row.payee_state).toUpperCase(),
    payee_city: text(row.recipient_city || row.payee_city), payee_zip: text(row.recipient_zip || row.payee_zip),
    purpose, category, amount: String(row.disbursement_amount), transaction_id: row.sub_id,
    disbursement_date: row.disbursement_date ? String(row.disbursement_date).slice(0, 10) : null };
}
export function donorProjection(row, cycle) {
  const name = text(row.contributor_name);
  if (!name) throw importError('MISSING_CONTRIBUTOR_NAME');
  const value = { cycle, source: 'fec_schedule_a', donor_name: name, name, donor_type: text(row.entity_type_desc || row.entity_type),
    state: text(row.contributor_state).toUpperCase(), city: text(row.contributor_city), postal_code: text(row.contributor_zip),
    committee_id: row.committee_id, committee_name: text(row.committee?.name || row.committee_name || row.committee_id),
    employer: text(row.contributor_employer), occupation: text(row.contributor_occupation),
    amount: String(row.contribution_receipt_amount), contribution_count: 1, relationship_strength: 'Reported contribution',
    contact_source: 'fec_disclosure', contact_verified: false };
  // This is a disclosure grouping, not verified person identity. Keep committees
  // and locations separate; do not attach inferred candidate or contact details.
  const key = JSON.stringify([name.toUpperCase(), value.state, value.city.toUpperCase(), value.postal_code, value.committee_id, value.employer.toUpperCase(), value.occupation.toUpperCase()]);
  return { key, value };
}
