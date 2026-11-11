CREATE TABLE IF NOT EXISTS mailops_tracking_budget (
  id INTEGER PRIMARY KEY CHECK(id=1)
);
INSERT INTO mailops_tracking_budget(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS mailops_tracking_firms (
  firm_id INTEGER PRIMARY KEY REFERENCES firms(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mailops_tracking_campaigns (
  id UUID PRIMARY KEY,
  firm_id INTEGER NOT NULL REFERENCES firms(id),
  created_by_user TEXT NOT NULL,
  name TEXT NOT NULL,
  mailing_date DATE NOT NULL,
  source_mode TEXT NOT NULL CHECK (source_mode IN ('cat','production')),
  feed_token_hash TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, firm_id)
);
CREATE TABLE IF NOT EXISTS mailops_tracking_pieces (
  campaign_id UUID NOT NULL,
  firm_id INTEGER NOT NULL,
  imb TEXT NOT NULL CHECK (imb ~ '^[0-9]{20}([0-9]{5}|[0-9]{9}|[0-9]{11})?$'),
  sequence TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(campaign_id, imb),
  FOREIGN KEY(campaign_id,firm_id) REFERENCES mailops_tracking_campaigns(id,firm_id)
);
CREATE INDEX IF NOT EXISTS mailops_tracking_pieces_firm ON mailops_tracking_pieces(firm_id);
CREATE TABLE IF NOT EXISTS mailops_tracking_events (
  campaign_id UUID NOT NULL,
  firm_id INTEGER NOT NULL,
  imb TEXT NOT NULL,
  event_key TEXT NOT NULL,
  event_time TEXT NOT NULL,
  event_code TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('Actual','Assumed Actual','Assumed Logical','Logical')),
  facility TEXT NOT NULL DEFAULT '',
  facility_zip TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(campaign_id,event_key),
  FOREIGN KEY(campaign_id,firm_id) REFERENCES mailops_tracking_campaigns(id,firm_id),
  FOREIGN KEY(campaign_id,imb) REFERENCES mailops_tracking_pieces(campaign_id,imb)
);
CREATE INDEX IF NOT EXISTS mailops_tracking_events_firm ON mailops_tracking_events(firm_id);
CREATE INDEX IF NOT EXISTS mailops_tracking_events_piece ON mailops_tracking_events(campaign_id,imb,event_time DESC);
CREATE TABLE IF NOT EXISTS mailops_tracking_batches (
  campaign_id UUID NOT NULL,
  firm_id INTEGER NOT NULL,
  file_hash TEXT NOT NULL,
  input_rows INTEGER NOT NULL,
  inserted_rows INTEGER NOT NULL,
  unmatched_rows INTEGER NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(campaign_id,file_hash),
  FOREIGN KEY(campaign_id,firm_id) REFERENCES mailops_tracking_campaigns(id,firm_id)
);
