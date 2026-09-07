BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS ux_workspaces_id_firm ON workspaces (id, firm_id);
CREATE INDEX IF NOT EXISTS ix_tasks_firm_id_id ON tasks (firm_id, id); 
CREATE INDEX IF NOT EXISTS ix_tasks_firm_workspace ON tasks (firm_id, workspace_id);
CREATE INDEX IF NOT EXISTS ix_task_comments_firm_task ON task_comments (firm_id, task_id);
CREATE INDEX IF NOT EXISTS ix_task_activity_firm_task ON task_activity (firm_id, task_id);
CREATE INDEX IF NOT EXISTS ix_campaigns_firm_id_id ON campaigns (firm_id, id);
CREATE INDEX IF NOT EXISTS ix_campaign_crm_contacts_firm_id ON campaign_crm_contacts (firm_id, id);
CREATE INDEX IF NOT EXISTS ix_campaign_crm_activities_firm_id ON campaign_crm_activities (firm_id, id);

UPDATE task_comments c
SET firm_id = t.firm_id, workspace_id = COALESCE(c.workspace_id, t.workspace_id)
FROM tasks t
WHERE c.task_id = t.id AND (c.firm_id IS NULL OR c.firm_id <> t.firm_id);

UPDATE task_activity a
SET firm_id = t.firm_id, workspace_id = COALESCE(a.workspace_id, t.workspace_id)
FROM tasks t
WHERE a.task_id = t.id AND (a.firm_id IS NULL OR a.firm_id <> t.firm_id);

DO $$ BEGIN
  ALTER TABLE tasks ADD CONSTRAINT fk_tasks_workspace_tenant
    FOREIGN KEY (workspace_id, firm_id) REFERENCES workspaces (id, firm_id) NOT VALID;
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER,
  firm_id INTEGER,
  action TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  outcome TEXT NOT NULL,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_security_audit_firm_created ON security_audit_log (firm_id, created_at DESC);

COMMIT;
