ALTER TABLE "channel_sync" ADD COLUMN IF NOT EXISTS "payload_hash" varchar(64);
