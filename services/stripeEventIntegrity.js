// A session lock spans application work. A crashed session releases its lock,
// allowing Stripe's retry to recover an unfinished event.
export async function withStripeEvent(pool, event, apply) {
  if (!event?.id || !event?.type) throw new Error('Stripe event id and type are required');
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [`stripe-event:${event.id}`]);
    locked = lock.rows[0]?.acquired === true;
    if (!locked) throw Object.assign(new Error('Stripe event is being processed; retry delivery.'), { statusCode: 503 });
    await client.query(`CREATE TABLE IF NOT EXISTS stripe_webhook_events (event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'processing', processed_at TIMESTAMPTZ, error_message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const existing = await client.query('SELECT status FROM stripe_webhook_events WHERE event_id = $1', [event.id]);
    if (existing.rows[0]?.status === 'completed') return { received: true, duplicate: true, eventId: event.id, eventType: event.type };
    await client.query(`INSERT INTO stripe_webhook_events (event_id,event_type,status) VALUES ($1,$2,'processing') ON CONFLICT (event_id) DO UPDATE SET status='processing',error_message=NULL,processed_at=NULL`, [event.id, event.type]);
    try {
      const result = await apply();
      await client.query("UPDATE stripe_webhook_events SET status='completed',processed_at=NOW(),error_message=NULL WHERE event_id=$1", [event.id]);
      return result;
    } catch (error) {
      await client.query("UPDATE stripe_webhook_events SET status='failed',processed_at=NOW(),error_message=$2 WHERE event_id=$1", [event.id, 'Processing failed; inspect sanitized application logs.']);
      throw error;
    }
  } finally {
    try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`stripe-event:${event.id}`]); }
    finally { client.release(); }
  }
}
