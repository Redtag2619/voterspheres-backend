// A hold leaves scan state and publication pointers untouched.
export async function readMoneyScopeHold(client, config) {
  const result = await client.query(`SELECT held_at, reason FROM money_import_scope_holds
    WHERE lane=$1 AND cycle=$2 AND scope_key=$3`, [config.lane, config.cycle, config.key]);
  return result.rows[0] || null;
}

export function heldScopeWarning(row) {
  return row.held_at ? `${row.lane}/${row.cycle}/${row.scope_key}: intentionally held (${row.hold_reason}); no automatic resume` : null;
}
