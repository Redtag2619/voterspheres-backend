-- Applied only by installResumableMoneyStorage.mjs in one transaction.
-- Kept outside db/migrations so the generic runner cannot apply it independently.
CREATE TABLE money_import_scans (
 id UUID PRIMARY KEY, lane TEXT NOT NULL, cycle INTEGER NOT NULL, scope_key TEXT NOT NULL,
 config JSONB NOT NULL, cutoff DATE NOT NULL, cursor JSONB NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'paused', pages INTEGER NOT NULL DEFAULT 0,
 records BIGINT NOT NULL DEFAULT 0, anchor TEXT, publish_cursor TEXT, last_error TEXT,
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ
);
CREATE TABLE money_import_checkpoints (
 lane TEXT NOT NULL, cycle INTEGER NOT NULL, scope_key TEXT NOT NULL, committees JSONB NOT NULL,
 active_scan_id UUID REFERENCES money_import_scans(id), published_scan_id UUID REFERENCES money_import_scans(id),
 published_at TIMESTAMPTZ, needs_scores BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(lane,cycle,scope_key)
);
CREATE TABLE money_import_records (
 scan_id UUID NOT NULL REFERENCES money_import_scans(id), record_id TEXT NOT NULL,
 digest TEXT NOT NULL, payload JSONB NOT NULL, PRIMARY KEY(scan_id,record_id)
);
CREATE TABLE money_import_pages (
 scan_id UUID NOT NULL REFERENCES money_import_scans(id), ordinal INTEGER NOT NULL,
 fingerprint TEXT NOT NULL, rows_received INTEGER NOT NULL, PRIMARY KEY(scan_id,ordinal)
);
CREATE INDEX money_import_page_fingerprints ON money_import_pages(scan_id,fingerprint);
CREATE TABLE money_vendor_snapshots (
 scan_id UUID NOT NULL REFERENCES money_import_scans(id), record_id TEXT NOT NULL,
 committee_id TEXT NOT NULL, payload JSONB NOT NULL, PRIMARY KEY(scan_id,record_id)
);
CREATE TABLE money_donor_snapshots (
 row_id SERIAL PRIMARY KEY, scan_id UUID NOT NULL REFERENCES money_import_scans(id), donor_key TEXT NOT NULL,
 committee_id TEXT NOT NULL, payload JSONB NOT NULL, amount NUMERIC NOT NULL, contributions INTEGER NOT NULL,
 UNIQUE(scan_id,donor_key)
);
ALTER TABLE political_money_transactions ADD COLUMN money_scan_id UUID REFERENCES money_import_scans(id);
ALTER TABLE political_money_evidence ADD COLUMN money_scan_id UUID REFERENCES money_import_scans(id);
ALTER TABLE political_money_evidence ADD COLUMN money_committee_id TEXT;

-- Reject unexpected financial differences rather than deciding amendments.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vendor_fec_spend WHERE cycle IS NULL OR NULLIF(BTRIM(source),'') IS NULL OR NULLIF(BTRIM(committee_id),'') IS NULL OR NULLIF(BTRIM(transaction_id),'') IS NULL) THEN
  RAISE EXCEPTION 'VENDOR_MISSING_IDENTITY';
 END IF;
 IF EXISTS(
  SELECT 1 FROM vendor_fec_spend v GROUP BY source,cycle,committee_id,transaction_id
  HAVING COUNT(DISTINCT (to_jsonb(v)-'id'-'created_at'-'updated_at'-'source_updated_at'-'committee_name')::text)>1
 ) THEN RAISE EXCEPTION 'VENDOR_FINANCIAL_CONFLICT'; END IF;
END $$;
CREATE TABLE money_vendor_baseline AS
WITH ranked AS (
 SELECT v.*, ROW_NUMBER() OVER(PARTITION BY source,cycle,committee_id,transaction_id ORDER BY id) AS position
 FROM vendor_fec_spend v
), aliases AS (
 SELECT source,cycle,committee_id,transaction_id,COUNT(*) AS original_copies,
        ARRAY_AGG(DISTINCT committee_name ORDER BY committee_name) FILTER(WHERE NULLIF(BTRIM(committee_name),'') IS NOT NULL) AS names
 FROM vendor_fec_spend GROUP BY source,cycle,committee_id,transaction_id
)
SELECT r.source,r.cycle,r.committee_id,r.transaction_id,a.original_copies,a.names AS committee_name_aliases,
       (to_jsonb(r)-'position') || jsonb_build_object('committee_name',CASE WHEN COALESCE(array_length(a.names,1),0)=1 THEN a.names[1] ELSE r.committee_id END) AS payload
FROM ranked r JOIN aliases a USING(source,cycle,committee_id,transaction_id) WHERE r.position=1;
CREATE UNIQUE INDEX money_vendor_baseline_key ON money_vendor_baseline(source,cycle,committee_id,transaction_id);

CREATE FUNCTION money_published_scan(request_lane TEXT,request_cycle INTEGER,request_committee TEXT)
RETURNS UUID LANGUAGE SQL STABLE AS $$
 SELECT c.published_scan_id FROM money_import_checkpoints c JOIN money_import_scans s ON s.id=c.published_scan_id
 WHERE c.lane=request_lane AND c.cycle=request_cycle AND c.published_scan_id IS NOT NULL
 AND (c.scope_key='national' OR c.committees ? request_committee)
 ORDER BY s.cutoff DESC,c.published_at DESC,c.scope_key LIMIT 1
$$;

CREATE VIEW vendor_fec_spend_read AS
SELECT (jsonb_populate_record(NULL::vendor_fec_spend,b.payload)).*
FROM money_vendor_baseline b WHERE money_published_scan('vendors',b.cycle,b.committee_id) IS NULL
UNION ALL
SELECT (jsonb_populate_record(NULL::vendor_fec_spend,
 v.payload || jsonb_build_object('source_updated_at',c.published_at,'updated_at',c.published_at))).*
FROM money_vendor_snapshots v JOIN money_import_scans s ON s.id=v.scan_id
JOIN money_import_checkpoints c ON c.published_scan_id=v.scan_id
WHERE v.scan_id=money_published_scan('vendors',s.cycle,v.committee_id);

-- Original donor aggregates do not have receipt identities. Do not add them to
-- new receipts and double count. Once receipts are published for a cycle, expose
-- only the explicitly published FEC scopes plus non-FEC records. Originals stay.
CREATE VIEW donors_read AS
SELECT d.* FROM donors d WHERE d.source IS DISTINCT FROM 'fec_schedule_a'
 OR NOT EXISTS(SELECT 1 FROM money_import_checkpoints c WHERE c.lane='donors' AND c.cycle=d.cycle AND c.published_scan_id IS NOT NULL)
UNION ALL
SELECT (jsonb_populate_record(NULL::donors,d.payload || jsonb_build_object(
 'id',-d.row_id,'amount',d.amount,'contribution_count',d.contributions,
 'source_updated_at',c.published_at,'updated_at',c.published_at))).*
FROM money_donor_snapshots d JOIN money_import_scans s ON s.id=d.scan_id
JOIN money_import_checkpoints c ON c.published_scan_id=d.scan_id
WHERE d.scan_id=money_published_scan('donors',s.cycle,d.committee_id);

CREATE VIEW political_money_transactions_read AS
SELECT t.* FROM political_money_transactions t
WHERE CASE WHEN t.provider='openfec' AND t.transaction_type='independent_expenditure'
 THEN CASE WHEN money_published_scan('political-money',t.cycle,t.fec_committee_id) IS NULL THEN t.money_scan_id IS NULL
 ELSE t.money_scan_id=money_published_scan('political-money',t.cycle,t.fec_committee_id) END
 ELSE TRUE END;
CREATE VIEW political_money_evidence_read AS
SELECT e.* FROM political_money_evidence e
LEFT JOIN LATERAL (SELECT COALESCE(e.money_committee_id,
 (SELECT t.fec_committee_id FROM political_money_transactions t WHERE t.provider=e.provider AND t.source_record_id=e.source_record_id AND t.cycle IS NOT DISTINCT FROM e.cycle LIMIT 1)) AS committee_id) i ON TRUE
WHERE CASE WHEN e.provider='openfec' AND e.evidence_type='independent_expenditure'
 THEN CASE WHEN money_published_scan('political-money',e.cycle,i.committee_id) IS NULL THEN e.money_scan_id IS NULL
 ELSE e.money_scan_id=money_published_scan('political-money',e.cycle,i.committee_id) END
 ELSE TRUE END;

CREATE TABLE resumable_money_storage_version(version INTEGER PRIMARY KEY,installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
INSERT INTO resumable_money_storage_version(version) VALUES(1);
