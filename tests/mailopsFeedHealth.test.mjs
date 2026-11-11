import {test} from "node:test";
import assert from "node:assert/strict";
import {feedHealth} from "../services/mailopsTracking/feedHealth.js";
const now=new Date("2026-11-11T12:00:00Z");
const base={campaign:{feed_enabled:true},totals:{total_pieces:3,actual_scan_pieces:1,no_scan_received:1},lastFeed:null,batches:{receipt_count:"0",input_rows:"0",inserted_events:"0",unmatched_rows:"0"},noEventSample:[],now};
test("receipt statuses distinguish setup, missing receipt, review boundary and invalid dates",()=>{
  assert.equal(feedHealth(base).status,"awaiting_first_receipt");
  assert.equal(feedHealth({...base,totals:{...base.totals,total_pieces:0}}).status,"manifest_required");
  assert.equal(feedHealth({...base,campaign:{feed_enabled:false}}).status,"relay_token_disabled");
  for(const [time,status] of [["2026-11-11T11:00:00Z","recent_receipt"],["2026-11-10T12:00:00Z","receipt_needs_review"],["2026-11-12T12:00:00Z","receipt_time_needs_review"],["bad","receipt_time_needs_review"]]){
    assert.equal(feedHealth({...base,lastFeed:{received_at:time}}).status,status);
  }
});
test("evidence and unknown telemetry stay explicit; exception counts are not delivery claims",()=>{
  const result=feedHealth({...base,batches:{receipt_count:"2",input_rows:"9",inserted_events:"3",unmatched_rows:"4"}});
  assert.equal(result.exceptions.pieces_without_physical_scan,2);
  assert.equal(result.exceptions.no_reported_event_pieces,1);
  assert.equal(result.unmatched_rows,4);
  assert.equal(result.relay_connection,"not_observed");
  assert.equal(result.rejected_files,"not_reported_by_relay");
  assert.equal(result.evidence.documented_acceptance,"not_collected_for_this_campaign");
  assert.equal(Object.hasOwn(result,"delivered"),false);
  assert.throws(()=>feedHealth({...base,now:"bad"}),/INVALID_HEALTH_CLOCK/);
});
