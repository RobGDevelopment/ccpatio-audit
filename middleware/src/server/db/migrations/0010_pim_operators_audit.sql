-- PIM operator registry + change audit trail for team accountability

CREATE TABLE IF NOT EXISTS pim_operators (
  email text PRIMARY KEY,
  display_name text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pim_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_email text NOT NULL,
  operator_name text,
  global_sku text,
  action text NOT NULL,
  field text,
  old_value text,
  new_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pim_audit_log_created_at_idx
  ON pim_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS pim_audit_log_sku_idx
  ON pim_audit_log (global_sku);

CREATE INDEX IF NOT EXISTS pim_audit_log_operator_idx
  ON pim_audit_log (operator_email);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE pim_audit_log;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
