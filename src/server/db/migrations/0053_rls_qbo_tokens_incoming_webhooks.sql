-- 0053_rls_qbo_tokens_incoming_webhooks.sql
-- Phase 8 / Step 2 (DB hardening). Additive only: no table, column, or row is touched.
--
-- qbo_auth_tokens holds the QuickBooks OAuth access and refresh tokens.
-- incoming_webhooks holds raw webhook payloads (customer PII from Woo and GHL).
-- Neither table had RLS, so anything granted to anon / authenticated on the
-- Supabase Data API could read them.
--
-- No policies are created on purpose: with RLS enabled and no policy, anon and
-- authenticated are denied every row. App access is POSTGRES_URL (the table
-- owner), which bypasses RLS. Same convention as 0024_hub_tables_rls_lockdown.sql.
-- FORCE ROW LEVEL SECURITY is NOT used: it would also bind the owner role the app
-- connects as.
--
-- Safe to re-run: ENABLE ROW LEVEL SECURITY and REVOKE are both idempotent, and
-- the REVOKE is guarded for databases that do not define the Supabase roles.

ALTER TABLE "qbo_auth_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incoming_webhooks" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  REVOKE ALL ON TABLE "qbo_auth_tokens" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE ALL ON TABLE "incoming_webhooks" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
