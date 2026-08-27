-- sku_mappings, quarantined_orders, katana_mo_records
-- Apply against the same Postgres as POSTGRES_URL.

CREATE TABLE IF NOT EXISTS sku_mappings (
  global_sku text PRIMARY KEY,
  category text NOT NULL,
  original_name text NOT NULL DEFAULT '',
  source_file text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  katana_variant_id integer,
  katana_material_id integer,
  woo_attribute_slug text,
  ghl_dropdown_value text
);

CREATE TABLE IF NOT EXISTS quarantined_orders (
  id serial PRIMARY KEY,
  source text NOT NULL,
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  issues jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending_review',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS katana_mo_records (
  id serial PRIMARY KEY,
  external_ref text NOT NULL UNIQUE,
  katana_mo_id text NOT NULL,
  status text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
