-- Phase 3: Incoming webhook idempotency + error tracking.

CREATE TABLE IF NOT EXISTS incoming_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  event_name text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received',
  error_message text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incoming_webhooks_source_status_idx
  ON incoming_webhooks (source, status);

CREATE INDEX IF NOT EXISTS incoming_webhooks_created_at_idx
  ON incoming_webhooks (created_at DESC);
