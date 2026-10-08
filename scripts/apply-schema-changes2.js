const fs = require('fs');
let code = fs.readFileSync('src/server/db/schema.ts', 'utf8');

// Update finished_goods_catalog
code = code.replace(
  '  is_web_visible: boolean("is_web_visible").default(false),\n  /** Operator / device label for multi-browser audit trail. */',
  '  is_web_visible: boolean("is_web_visible").default(false),\n  assembly_required: boolean("assembly_required").notNull().default(false),\n  warranty_term_months: integer("warranty_term_months"),\n  warranty_covers: text("warranty_covers"),\n  /** Operator / device label for multi-browser audit trail. */'
);
code = code.replace(
  '  is_web_visible: boolean("is_web_visible").default(false),\r\n  /** Operator / device label for multi-browser audit trail. */',
  '  is_web_visible: boolean("is_web_visible").default(false),\r\n  assembly_required: boolean("assembly_required").notNull().default(false),\r\n  warranty_term_months: integer("warranty_term_months"),\r\n  warranty_covers: text("warranty_covers"),\r\n  /** Operator / device label for multi-browser audit trail. */'
);

// Update ecommerce_listings
code = code.replace(
  '    construction_details: text("construction_details"),\n    sheet_order: integer("sheet_order").notNull(),',
  '    construction_details: text("construction_details"),\n    seo_title: text("seo_title"),\n    seo_description: text("seo_description"),\n    slug: text("slug"),\n    tags: jsonb("tags").$type<string[]>().notNull().default([]),\n    sheet_order: integer("sheet_order").notNull(),'
);
code = code.replace(
  '    construction_details: text("construction_details"),\r\n    sheet_order: integer("sheet_order").notNull(),',
  '    construction_details: text("construction_details"),\r\n    seo_title: text("seo_title"),\r\n    seo_description: text("seo_description"),\r\n    slug: text("slug"),\r\n    tags: jsonb("tags").$type<string[]>().notNull().default([]),\r\n    sheet_order: integer("sheet_order").notNull(),'
);

// Update productAssetKindEnum
code = code.replace(
  'export const productAssetKindEnum = pgEnum("product_asset_kind", [\n  "cad_model",\n  "tear_sheet",\n  "assembly",\n  "gallery",\n]);',
  'export const productAssetKindEnum = pgEnum("product_asset_kind", [\n  "cad_model",\n  "primary_image",\n  "tear_sheet",\n  "assembly",\n  "care_guide",\n  "warranty",\n  "gallery",\n]);'
);
code = code.replace(
  'export const productAssetKindEnum = pgEnum("product_asset_kind", [\r\n  "cad_model",\r\n  "tear_sheet",\r\n  "assembly",\r\n  "gallery",\r\n]);',
  'export const productAssetKindEnum = pgEnum("product_asset_kind", [\r\n  "cad_model",\r\n  "primary_image",\r\n  "tear_sheet",\r\n  "assembly",\r\n  "care_guide",\r\n  "warranty",\r\n  "gallery",\r\n]);'
);

// Update product_assets
code = code.replace(
  '    byte_size: integer("byte_size").notNull(),\n    created_at: timestamp("created_at").defaultNow().notNull(),',
  '    byte_size: integer("byte_size").notNull(),\n    revision: integer("revision").notNull().default(1),\n    sha256: text("sha256"),\n    effective_on: timestamp("effective_on").defaultNow().notNull(),\n    is_current: boolean("is_current").notNull().default(true),\n    superseded_at: timestamp("superseded_at"),\n    sort_order: integer("sort_order"),\n    alt_text: text("alt_text"),\n    created_at: timestamp("created_at").defaultNow().notNull(),'
);
code = code.replace(
  '    byte_size: integer("byte_size").notNull(),\r\n    created_at: timestamp("created_at").defaultNow().notNull(),',
  '    byte_size: integer("byte_size").notNull(),\r\n    revision: integer("revision").notNull().default(1),\r\n    sha256: text("sha256"),\r\n    effective_on: timestamp("effective_on").defaultNow().notNull(),\r\n    is_current: boolean("is_current").notNull().default(true),\r\n    superseded_at: timestamp("superseded_at"),\r\n    sort_order: integer("sort_order"),\r\n    alt_text: text("alt_text"),\r\n    created_at: timestamp("created_at").defaultNow().notNull(),'
);

// Also need to add unique constraint for product_assets. But let's just make these additions first.

fs.writeFileSync('src/server/db/schema.ts', code);
