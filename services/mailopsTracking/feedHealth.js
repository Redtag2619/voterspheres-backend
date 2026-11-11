// Receipt age is a review threshold, not a USPS service standard or relay heartbeat.
export const FEED_REVIEW_HOURS = 24;
export function feedHealth({campaign, totals, lastFeed, batches, noEventSample, now = new Date()}) {
  const checked = new Date(now);
  if (!Number.isFinite(checked.getTime())) throw new Error("INVALID_HEALTH_CLOCK");
  const received = lastFeed ? new Date(lastFeed.received_at) : null;
  const validReceipt = received && Number.isFinite(received.getTime()) && received <= checked;
  const age = validReceipt ? Math.floor((checked - received) / 1000) : null;
  let status;
  if (!totals.total_pieces) status = "manifest_required";
  else if (!campaign.feed_enabled) status = "relay_token_disabled";
  else if (!lastFeed) status = "awaiting_first_receipt";
  else if (!validReceipt) status = "receipt_time_needs_review";
  else if (age >= FEED_REVIEW_HOURS * 3600) status = "receipt_needs_review";
  else status = "recent_receipt";
  return {
    checked_at: checked.toISOString(), status,
    review_after_hours: FEED_REVIEW_HOURS, receipt_age_seconds: age,
    last_received_at: lastFeed?.received_at ?? null,
    receipt_count: Number(batches.receipt_count),
    input_rows: Number(batches.input_rows), inserted_events: Number(batches.inserted_events),
    unmatched_rows: Number(batches.unmatched_rows),
    exceptions: {
      no_reported_event_pieces: totals.no_scan_received,
      pieces_without_physical_scan: totals.total_pieces - totals.actual_scan_pieces,
      latest_file_unmatched_rows: Number(lastFeed?.unmatched_rows ?? 0),
      no_event_sample: noEventSample, sample_limit: 25,
    },
    evidence: {documented_acceptance:"not_collected_for_this_campaign", estimated_arrival:"not_configured"},
    rejected_files:"not_reported_by_relay", relay_connection:"not_observed",
  };
}
