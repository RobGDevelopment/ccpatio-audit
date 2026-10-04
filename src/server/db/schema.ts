/**
 * Drizzle schema for middleware persistence.
 *
 * ORM choice: Drizzle (already configured in this repo via topology/;
 * V8 rules explicitly exclude Prisma). These tables live in the same
 * Postgres instance (POSTGRES_URL).
 */
import {
  boolean,
  check,
  index,
  char,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/** Manufacturing / BOM role — orthogonal to display `category`. */
export const itemTypeEnum = pgEnum("item_type", [
  "raw_material",
  "sub_assembly",
  "finished_good",
  "service",
]);

export const productOriginEnum = pgEnum("product_origin", [
  "manufactured",
  "third_party",
]);

export const userRoleEnum = pgEnum("user_role", [
  "SuperAdmin",
  "IT_Admin",
  "Ops_Manager",
  "Designer",
]);

export type ItemType = (typeof itemTypeEnum.enumValues)[number];
export type UserRole = (typeof userRoleEnum.enumValues)[number];

export type QboAccounts = {
  income?: string;
  cogs?: string;
  asset?: string;
  class?: string;
};

/** Canonical join: Global E2E SKU → Katana IDs + Woo/GHL display values. */
export const sku_mappings = pgTable("sku_mappings", {
  global_sku: text("global_sku").primaryKey(),
  product_origin: productOriginEnum("product_origin"),
  category: text("category").notNull(),
  item_type: itemTypeEnum("item_type").notNull().default("raw_material"),
  original_name: text("original_name").notNull().default(""),
  source_file: text("source_file").notNull().default(""),
  is_active: boolean("is_active").notNull().default(true),
  /** When true, SKU is eligible for WooCommerce catalog export. */
  sync_to_woo: boolean("sync_to_woo").notNull().default(false),
  /** When true, SKU is eligible for Clover POS catalog export. */
  sync_to_clover: boolean("sync_to_clover").notNull().default(false),
  uom_purchase: text("uom_purchase"),
  uom_consume: text("uom_consume"),
  base_cost: numeric("base_cost", { precision: 12, scale: 4 }),
  katana_variant_id: integer("katana_variant_id"),
  katana_material_id: integer("katana_material_id"),
  woo_product_id: varchar("woo_product_id", { length: 255 }),
  clover_item_id: varchar("clover_item_id", { length: 255 }),
  qbo_item_id: varchar("qbo_item_id", { length: 255 }),
  woo_attribute_slug: text("woo_attribute_slug"),
  ghl_dropdown_value: text("ghl_dropdown_value"),
  qbo_accounts: jsonb("qbo_accounts").$type<QboAccounts>().notNull().default({}),
  /** Category-specific manufacturing / commerce attrs (Zod-validated). */
  attributes: jsonb("attributes")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  /** Optimistic concurrency for multi-operator dictionary edits. */
  version: integer("version").notNull().default(1),
  updated_by: text("updated_by"),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  check(
    "origin_check",
    sql`(product_origin = \'manufactured\' AND global_sku LIKE \'FIN-%\') OR (product_origin = \'third_party\' AND global_sku LIKE \'3P-%\') OR (product_origin IS NULL)`
  )
]);

/**
 * PIM commerce attributes for finished goods (MSRP, dims, copy).
 * PK/FK → sku_mappings.global_sku. image_url is executive-owned — seeder
 * must not clobber a saved URL on re-seed.
 */
export const finished_goods_catalog = pgTable("finished_goods_catalog", {
  global_sku: text("global_sku")
    .primaryKey()
    .references(() => sku_mappings.global_sku, { onUpdate: "cascade" }),
  msrp: text("msrp"),
  cost: text("cost"),
  length: text("length"),
  depth: text("depth"),
  height: text("height"),
  arm_height: text("arm_height"),
  sit_height: text("sit_height"),
  weight: text("weight"),
  description: text("description"),
  image_url: text("image_url"),
  qbo_item_code: text("qbo_item_code"),
  /** Woo / catalog URL slug (MDM Phase 1). */
  slug: text("slug"),
  seo_title: text("seo_title"),
  seo_description: text("seo_description"),
  /**
   * PIM fields explicitly marked Not Applicable (e.g. arm_height on a table).
   * Values are DataHealthField keys: msrp | length | depth | height |
   * arm_height | sit_height | image
   */
  na_fields: jsonb("na_fields").$type<string[]>().notNull().default([]),
  is_web_visible: boolean("is_web_visible").default(false),
  assembly_required: boolean("assembly_required").notNull().default(false),
  warranty_term_months: integer("warranty_term_months"),
  warranty_covers: text("warranty_covers"),
  /** Operator / device label for multi-browser audit trail. */
  updated_by: text("updated_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const quarantine_catalog = pgTable("quarantine_catalog", {
  id: uuid("id").defaultRandom().primaryKey(),
  sheet_description: varchar("sheet_description", { length: 255 }).notNull(),
  target_msrp: numeric("target_msrp", { precision: 10, scale: 2 }),
  is_web_visible: boolean("is_web_visible").default(false),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const qbo_auth_tokens = pgTable("qbo_auth_tokens", {
  id: boolean("id").primaryKey().default(true),
  realm_id: varchar("realm_id", { length: 255 }),
  access_token: text("access_token"),
  refresh_token: text("refresh_token"),
  expires_at: timestamp("expires_at"),
});

/**
 * Backward-compatible aliases after finished-good SKU renames.
 * alias_sku (deprecated) → canonical_sku (current hub PK).
 */
export const sku_aliases = pgTable("sku_aliases", {
  alias_sku: text("alias_sku").primaryKey(),
  canonical_sku: text("canonical_sku")
    .notNull()
    .references(() => sku_mappings.global_sku, { onUpdate: "cascade" }),
  reason: text("reason"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Multi-level BOM — parent (finished_good | sub_assembly) → child
 * (raw_material | sub_assembly). Quantity pushed to Katana is
 * quantity * scrap_factor.
 */
export const product_bom = pgTable(
  "product_bom",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parent_sku: text("parent_sku")
      .notNull()
      .references(() => sku_mappings.global_sku, {
        onUpdate: "cascade",
        onDelete: "cascade",
      }),
    child_sku: text("child_sku")
      .notNull()
      .references(() => sku_mappings.global_sku, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
    scrap_factor: numeric("scrap_factor", { precision: 12, scale: 4 })
      .notNull()
      .default("1.0000"),
    unit_of_measure: text("unit_of_measure").notNull(),
    /** Chop-saw cut-list / mitre notes for Katana recipe row notes. */
    notes: text("notes"),
    /** Structured cut pieces (drawing CUT-* identity) — not Katana children. */
    cut_list: jsonb("cut_list")
      .$type<
        Array<{
          role: string;
          profile: string;
          lengthIn: number;
          endA: number | null;
          endB: number | null;
          qtyEa: number;
          lengthConvention: string;
          sourceName: string;
          confidence: string;
          drawingPartNumber: string | null;
        }>
      >()
      .notNull()
      .default([]),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("product_bom_parent_child_uidx").on(
      table.parent_sku,
      table.child_sku,
    ),
  ],
);

/**
 * Manufacturing routings for a producible SKU (finished_good | sub_assembly).
 * Times stored in minutes; Katana sync converts to seconds.
 * Unique (item_sku, work_center, sequence) enables Approve upsert of times.
 */
export const item_operations = pgTable(
  "item_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    item_sku: text("item_sku")
      .notNull()
      .references(() => sku_mappings.global_sku, {
        onUpdate: "cascade",
        onDelete: "cascade",
      }),
    work_center: varchar("work_center", { length: 120 }).notNull(),
    sequence: integer("sequence").notNull().default(10),
    setup_time_mins: numeric("setup_time_mins", { precision: 12, scale: 4 }),
    run_time_mins: numeric("run_time_mins", { precision: 12, scale: 4 }),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("item_operations_sku_wc_seq_uidx").on(
      table.item_sku,
      table.work_center,
      table.sequence,
    ),
  ],
);

/** Factory recipe review — drafts never feed explodeBomTree / Katana. */
export const recipeReviewStatusEnum = pgEnum("recipe_review_status", [
  "draft_pending_review",
  "edited",
  "factory_approved",
]);

export const recipeSourceEnum = pgEnum("recipe_source", [
  "heuristic",
  "manager",
  "katana_import",
  "sketchup_geometry",
  "secondary_extract",
]);

export type RecipeReviewStatus =
  (typeof recipeReviewStatusEnum.enumValues)[number];
export type RecipeSource = (typeof recipeSourceEnum.enumValues)[number];

/**
 * Manager-editable physics constants for Secondary Extraction (mass / powder area).
 * Prefer sku_mappings.attributes.weight_plf when set on the RM row.
 */
export const material_physics_factors = pgTable(
  "material_physics_factors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    material_sku: text("material_sku")
      .notNull()
      .references(() => sku_mappings.global_sku, {
        onUpdate: "cascade",
        onDelete: "cascade",
      }),
    profile_code: text("profile_code").notNull().default(""),
    weight_plf: numeric("weight_plf", { precision: 12, scale: 4 }),
    density_pcf: numeric("density_pcf", { precision: 12, scale: 4 }),
    oz_per_yd2: numeric("oz_per_yd2", { precision: 12, scale: 4 }),
    fabric_width_in: numeric("fabric_width_in", { precision: 12, scale: 4 }),
    perimeter_in: numeric("perimeter_in", { precision: 12, scale: 4 }),
    coverage_sqft_per_lb: numeric("coverage_sqft_per_lb", {
      precision: 12,
      scale: 4,
    }),
    notes: text("notes"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("material_physics_factors_sku_profile_uidx").on(
      table.material_sku,
      table.profile_code,
    ),
  ],
);

/**
 * Draft-only Secondary Extraction outputs (weight / DIM / labor / packaging).
 * Never feeds Katana until Approve copies selected fields.
 */
export const recipe_estimates_draft = pgTable("recipe_estimates_draft", {
  root_sku: text("root_sku")
    .primaryKey()
    .references(() => sku_mappings.global_sku, {
      onUpdate: "cascade",
      onDelete: "cascade",
    }),
  est_weight_lbs: numeric("est_weight_lbs", { precision: 12, scale: 4 }),
  weight_breakdown: jsonb("weight_breakdown")
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  est_dim_weight_lbs: numeric("est_dim_weight_lbs", { precision: 12, scale: 4 }),
  carton_lwh_in: jsonb("carton_lwh_in").$type<{
    l: number;
    w: number;
    h: number;
  } | null>(),
  packaging_bom: jsonb("packaging_bom").$type<Record<string, unknown> | null>(),
  est_labor_minutes: numeric("est_labor_minutes", { precision: 12, scale: 4 }),
  labor_breakdown: jsonb("labor_breakdown")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  est_packaging_cost: numeric("est_packaging_cost", { precision: 12, scale: 4 }),
  overrides: jsonb("overrides")
    .$type<{
      weightLbs?: number;
      dimWeightLbs?: number;
      laborMinutes?: number;
      includePackagingBom?: boolean;
      applyEstimatedWeight?: boolean;
    }>()
    .notNull()
    .default({}),
  status: recipeReviewStatusEnum("status")
    .notNull()
    .default("draft_pending_review"),
  source: recipeSourceEnum("source").notNull().default("secondary_extract"),
  calc_version: text("calc_version").notNull().default("1"),
  inputs_hash: text("inputs_hash"),
  reviewed_by: text("reviewed_by"),
  reviewed_at: timestamp("reviewed_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

/** CAD upload job tracker — Factory BOM drag-drop → Inngest draft extract. */
export const cadUploadStatusEnum = pgEnum("cad_upload_status", [
  "uploaded",
  "queued",
  "processing",
  "draft_ready",
  "failed",
]);

export type CadUploadStatus = (typeof cadUploadStatusEnum.enumValues)[number];

export const cadUploadThumbnailSourceEnum = pgEnum("cad_upload_thumbnail_source", [
  "skp_embed",
  "operator_upload",
  "none",
]);

export type CadUploadThumbnailSource =
  (typeof cadUploadThumbnailSourceEnum.enumValues)[number];

export const cad_uploads = pgTable("cad_uploads", {
  id: uuid("id").defaultRandom().primaryKey(),
  global_sku: text("global_sku")
    .notNull()
    .references(() => sku_mappings.global_sku, {
      onUpdate: "cascade",
      onDelete: "cascade",
    }),
  storage_path: text("storage_path").notNull(),
  original_filename: text("original_filename").notNull(),
  content_type: text("content_type"),
  byte_size: integer("byte_size"),
  sha256: text("sha256"),
  ext: text("ext").notNull(),
  status: cadUploadStatusEnum("status").notNull().default("uploaded"),
  inngest_event_id: text("inngest_event_id"),
  error_message: text("error_message"),
  thumbnail_source: cadUploadThumbnailSourceEnum("thumbnail_source")
    .notNull()
    .default("none"),
  thumbnail_url: text("thumbnail_url"),
  force_rename: boolean("force_rename").notNull().default(false),
  replace_image: boolean("replace_image").notNull().default(false),
  uploaded_by: text("uploaded_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("cad_uploads_global_sku_idx").on(table.global_sku),
  index("cad_uploads_status_idx").on(table.status),
]);

export const product_bom_draft = pgTable(
  "product_bom_draft",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parent_sku: text("parent_sku")
      .notNull()
      .references(() => sku_mappings.global_sku, {
        onUpdate: "cascade",
        onDelete: "cascade",
      }),
    child_sku: text("child_sku")
      .notNull()
      .references(() => sku_mappings.global_sku, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
    scrap_factor: numeric("scrap_factor", { precision: 12, scale: 4 })
      .notNull()
      .default("1.0000"),
    unit_of_measure: text("unit_of_measure").notNull(),
    status: recipeReviewStatusEnum("status")
      .notNull()
      .default("draft_pending_review"),
    source: recipeSourceEnum("source").notNull().default("heuristic"),
    notes: text("notes"),
    /** Structured cut pieces — mirrors live product_bom.cut_list (no JSON trailer). */
    cut_list: jsonb("cut_list")
      .$type<
        Array<{
          role: string;
          profile: string;
          lengthIn: number;
          endA: number | null;
          endB: number | null;
          qtyEa: number;
          lengthConvention: string;
          sourceName: string;
          confidence: string;
          drawingPartNumber: string | null;
        }>
      >()
      .notNull()
      .default([]),
    reviewed_by: text("reviewed_by"),
    reviewed_at: timestamp("reviewed_at"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("product_bom_draft_parent_child_uidx").on(
      table.parent_sku,
      table.child_sku,
    ),
    index("product_bom_draft_parent_sku_idx").on(table.parent_sku),
    index("product_bom_draft_status_idx").on(table.status),
  ],
);

export const item_operations_draft = pgTable("item_operations_draft", {
  id: uuid("id").defaultRandom().primaryKey(),
  item_sku: text("item_sku")
    .notNull()
    .references(() => sku_mappings.global_sku, {
      onUpdate: "cascade",
      onDelete: "cascade",
    }),
  work_center: varchar("work_center", { length: 120 }).notNull(),
  sequence: integer("sequence").notNull().default(10),
  setup_time_mins: numeric("setup_time_mins", { precision: 12, scale: 4 }),
  run_time_mins: numeric("run_time_mins", { precision: 12, scale: 4 }),
  status: recipeReviewStatusEnum("status")
    .notNull()
    .default("draft_pending_review"),
  source: recipeSourceEnum("source").notNull().default("heuristic"),
  notes: text("notes"),
  reviewed_by: text("reviewed_by"),
  reviewed_at: timestamp("reviewed_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("item_operations_draft_item_sku_idx").on(table.item_sku),
]);

export const skuMappingsRelations = relations(sku_mappings, ({ many }) => ({
  bomAsParent: many(product_bom, { relationName: "bom_parent" }),
  bomAsChild: many(product_bom, { relationName: "bom_child" }),
  operations: many(item_operations),
}));

export const productBomRelations = relations(product_bom, ({ one }) => ({
  parent: one(sku_mappings, {
    fields: [product_bom.parent_sku],
    references: [sku_mappings.global_sku],
    relationName: "bom_parent",
  }),
  child: one(sku_mappings, {
    fields: [product_bom.child_sku],
    references: [sku_mappings.global_sku],
    relationName: "bom_child",
  }),
}));

export const itemOperationsRelations = relations(item_operations, ({ one }) => ({
  item: one(sku_mappings, {
    fields: [item_operations.item_sku],
    references: [sku_mappings.global_sku],
  }),
}));

export const productBomDraftRelations = relations(
  product_bom_draft,
  ({ one }) => ({
    parent: one(sku_mappings, {
      fields: [product_bom_draft.parent_sku],
      references: [sku_mappings.global_sku],
      relationName: "bom_draft_parent",
    }),
    child: one(sku_mappings, {
      fields: [product_bom_draft.child_sku],
      references: [sku_mappings.global_sku],
      relationName: "bom_draft_child",
    }),
  }),
);

export const itemOperationsDraftRelations = relations(
  item_operations_draft,
  ({ one }) => ({
    item: one(sku_mappings, {
      fields: [item_operations_draft.item_sku],
      references: [sku_mappings.global_sku],
    }),
  }),
);

/**
 * Raw materials catalog — Katana materials, fabrics, powder, aluminum, etc.
 * `sku` must exist on the hub (`sku_mappings`) so BOM children stay consistent.
 */
export const raw_materials_catalog = pgTable("raw_materials_catalog", {
  id: uuid("id").defaultRandom().primaryKey(),
  sku: text("sku")
    .notNull()
    .unique()
    .references(() => sku_mappings.global_sku, {
      onUpdate: "cascade",
      onDelete: "restrict",
    }),
  name: text("name").notNull().default(""),
  category: text("category").notNull().default(""),
  unit_of_measure: text("unit_of_measure").notNull().default("ea"),
  cost_per_unit: numeric("cost_per_unit", { precision: 12, scale: 4 }),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

/** SketchUp / CAD intake lifecycle (MDM quarantine gate). */
export const productIntakeStatusEnum = pgEnum("product_intake_status", [
  "quarantined",
  "approved",
  "rejected",
  "superseded",
]);

export type ProductIntakeStatus =
  (typeof productIntakeStatusEnum.enumValues)[number];

/**
 * Validated SketchUp exports awaiting human MSRP/SEO review.
 * Invalid payloads never insert — Zod rejects at the webhook gateway.
 */
export const product_intake = pgTable("product_intake", {
  export_id: uuid("export_id").primaryKey(),
  status: productIntakeStatusEnum("status").notNull().default("quarantined"),
  raw_payload: jsonb("raw_payload").notNull(),
  zod_issues: jsonb("zod_issues").$type<unknown[] | null>(),
  proposed_sku: varchar("proposed_sku", { length: 120 }),
  created_by: varchar("created_by", { length: 255 }),
  reject_reason: text("reject_reason"),
  /** OCC token — bumped on every status mutation. */
  version: integer("version").notNull().default(1),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

/** GHL Produce Factory Order lifecycle (human SKU triage, then Katana). */
export const orderIntakeStatusEnum = pgEnum("order_intake_status", [
  "received",
  "approved",
  "pushed",
  "failed",
  "rejected",
]);

export type OrderIntakeStatus =
  (typeof orderIntakeStatusEnum.enumValues)[number];

export type OrderIntakeMappedLine = {
  finSku: string;
  fabricSku: string;
  quantity: number;
};

/** Present only after Katana accepts the hold line change. `applied` blocks a second deduct. */
export type OrderIntakeHoldRelief = {
  fabricSku: string;
  holdRowId: number;
  yardsBefore: number;
  yardsRelieved: number;
  applied: boolean;
};

/**
 * GHL opportunities waiting for a person to map FIN-* and FAB-* SKUs.
 * Invalid payloads never insert — Zod rejects at the webhook gateway.
 * Uniqueness is the GHL opportunity id.
 */
export const order_intake = pgTable(
  "order_intake",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ghl_opportunity_id: text("ghl_opportunity_id").notNull().unique(),
    status: orderIntakeStatusEnum("status").notNull().default("received"),
    raw_payload: jsonb("raw_payload").notNull(),
    zod_issues: jsonb("zod_issues").$type<unknown[] | null>(),
    contact_name: text("contact_name"),
    contact_email: text("contact_email"),
    stage_name: text("stage_name"),
    mapped_lines: jsonb("mapped_lines").$type<OrderIntakeMappedLine[] | null>(),
    katana_customer_id: integer("katana_customer_id"),
    katana_sales_order_id: integer("katana_sales_order_id"),
    katana_order_no: text("katana_order_no"),
    katana_mo_ids: jsonb("katana_mo_ids").$type<number[] | null>(),
    hold_relief: jsonb("hold_relief").$type<OrderIntakeHoldRelief[] | null>(),
    /** OCC token — bumped on every triage mutation. */
    version: integer("version").notNull().default(1),
    last_error: text("last_error"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("order_intake_status_idx").on(table.status)],
);

/** Showroom smart hold. 14 days from creation, extendable. Terminals are released and converted. */
export const inventoryHoldStatusEnum = pgEnum("inventory_hold_status", [
  "active",
  "releasing",
  "released",
  "converting",
  "converted",
]);

export type InventoryHoldStatus =
  (typeof inventoryHoldStatusEnum.enumValues)[number];

/** Null while the row is active, converting, or converted. */
export const inventoryHoldReleaseReasonEnum = pgEnum(
  "inventory_hold_release_reason",
  ["expired", "lost", "abandoned", "manual"],
);

export type InventoryHoldReleaseReason =
  (typeof inventoryHoldReleaseReasonEnum.enumValues)[number];

/**
 * Reservation ledger for showroom holds. Katana has no temporary hold, so
 * each row points at a HOLD- sales order. The browser never queries this table.
 */
export const inventory_holds = pgTable(
  "inventory_holds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    katana_variant_id: integer("katana_variant_id").notNull(),
    sku: text("sku").notNull(),
    qty: numeric("qty", { precision: 12, scale: 4 }).notNull(),
    /** Rep who owns the hold. GHL user id, or the Supabase user id for a direct login. */
    ghl_user_id: varchar("ghl_user_id", { length: 128 }).notNull(),
    ghl_user_name: text("ghl_user_name").notNull(),
    ghl_user_email: text("ghl_user_email"),
    ghl_contact_id: text("ghl_contact_id").notNull(),
    ghl_opportunity_id: text("ghl_opportunity_id").notNull(),
    ghl_opportunity_name: text("ghl_opportunity_name").notNull(),
    note: text("note").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`(now() + interval '14 days')`),
    /** Set when the 48-hour warning is delivered. Cleared on extend. */
    warning_sent_at: timestamp("warning_sent_at", { withTimezone: true }),
    status: inventoryHoldStatusEnum("status").notNull().default("active"),
    release_reason: inventoryHoldReleaseReasonEnum("release_reason"),
    released_by: text("released_by"),
    released_at: timestamp("released_at", { withTimezone: true }),
    katana_dummy_so_id: integer("katana_dummy_so_id").notNull().unique(),
    katana_sales_order_row_id: integer("katana_sales_order_row_id"),
    order_no: text("order_no").notNull().unique(),
    conversion_order_intake_id: uuid("conversion_order_intake_id").references(
      () => order_intake.id,
    ),
    converted_katana_so_id: integer("converted_katana_so_id"),
    converted_order_no: text("converted_order_no"),
    last_error: text("last_error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("inventory_holds_status_expires_idx").on(table.status, table.expires_at),
    index("inventory_holds_opportunity_status_idx").on(
      table.ghl_opportunity_id,
      table.status,
    ),
    index("inventory_holds_variant_status_idx").on(
      table.katana_variant_id,
      table.status,
    ),
    check("inventory_holds_qty_positive", sql`${table.qty} > 0`),
  ],
);

/** Commercial document statuses. Phase 1 writes `draft` and `void`. */
export const quoteStatusEnum = pgEnum("quote_status", [
  "draft",
  "sent",
  "deposit_paid",
  "paid",
  "converted",
  "void",
  "expired",
]);

export type QuoteStatus = (typeof quoteStatusEnum.enumValues)[number];

export const quoteLineKindEnum = pgEnum("quote_line_kind", [
  "stock_hold",
  "configured",
  "custom",
]);

export type QuoteLineKind = (typeof quoteLineKindEnum.enumValues)[number];

export const distanceSourceEnum = pgEnum("distance_source", [
  "geocode",
  "manual_override",
]);

export type DistanceSource = (typeof distanceSourceEnum.enumValues)[number];

export const freightMethodEnum = pgEnum("freight_method", [
  "LOCAL_WHITE_GLOVE",
  "INTERNAL_FLEET",
  "INTERNAL_FLEET_CURBSIDE",
  "INTERNAL_FLEET_WHITE_GLOVE",
  "INTERNAL_FLEET_FLAT_RATE",
  "PRIORITY1_LTL",
]);

export type FreightMethodColumn = (typeof freightMethodEnum.enumValues)[number];

export const quoteOverrideFieldEnum = pgEnum("quote_override_field", [
  "freight_total",
  "promise_date",
  "distance_miles",
  "hold_expires_at",
]);

export type QuoteOverrideField = (typeof quoteOverrideFieldEnum.enumValues)[number];

/**
 * One commercial document per open GoHighLevel opportunity.
 * Walk-in estimates leave the opportunity, contact, and name null until a
 * GoHighLevel opportunity exists. `current_revision_id` points at the live
 * sent revision. The browser never queries this table.
 */
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ghl_opportunity_id: text("ghl_opportunity_id"),
    ghl_contact_id: text("ghl_contact_id"),
    ghl_opportunity_name: text("ghl_opportunity_name"),
    ghl_user_id: varchar("ghl_user_id", { length: 128 }).notNull(),
    ghl_user_name: text("ghl_user_name").notNull(),
    ghl_user_email: text("ghl_user_email"),
    customer_name: text("customer_name"),
    customer_email: text("customer_email"),
    bill_to_address: text("bill_to_address"),
    ship_to_address: text("ship_to_address"),
    status: quoteStatusEnum("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    dest_zip: char("dest_zip", { length: 5 }),
    distance_miles: numeric("distance_miles", { precision: 8, scale: 2 }),
    distance_source: distanceSourceEnum("distance_source"),
    packed_height_in: numeric("packed_height_in", { precision: 6, scale: 2 })
      .notNull()
      .default("40.00"),
    merchandise_total: numeric("merchandise_total", { precision: 12, scale: 2 }),
    discount_amount: numeric("discount_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    discount_type: varchar("discount_type", { length: 16 }).notNull().default("FLAT"),
    tax_amount: numeric("tax_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    freight_method: freightMethodEnum("freight_method"),
    freight_total: numeric("freight_total", { precision: 12, scale: 2 }),
    calculated_freight_total: numeric("calculated_freight_total", {
      precision: 12,
      scale: 2,
    }),
    freight_snapshot: jsonb("freight_snapshot"),
    freight_input_hash: char("freight_input_hash", { length: 64 }),
    freight_quoted_at: timestamp("freight_quoted_at", { withTimezone: true }),
    freight_error: text("freight_error"),
    selected_carrier_code: text("selected_carrier_code"),
    freight_override_id: uuid("freight_override_id").references(
      (): AnyPgColumn => quote_overrides.id,
      { onDelete: "set null" },
    ),
    executed_by: date("executed_by").notNull(),
    promise_date: date("promise_date"),
    calculated_promise_date: date("calculated_promise_date"),
    promise_truck_code: text("promise_truck_code"),
    promise_formula: text("promise_formula"),
    promise_calculated_at: timestamp("promise_calculated_at", {
      withTimezone: true,
    }),
    promise_error: text("promise_error"),
    promise_override_id: uuid("promise_override_id").references(
      (): AnyPgColumn => quote_overrides.id,
      { onDelete: "set null" },
    ),
    deposit_pct: numeric("deposit_pct", { precision: 5, scale: 2 }),
    current_revision_id: uuid("current_revision_id").references(
      (): AnyPgColumn => quote_revisions.id,
      { onDelete: "set null" },
    ),
    order_intake_id: uuid("order_intake_id").references(() => order_intake.id),
    katana_sales_order_id: integer("katana_sales_order_id"),
    katana_order_no: text("katana_order_no"),
    commercial_conflict: text("commercial_conflict"),
    void_reason: text("void_reason"),
    ghl_sync_error: text("ghl_sync_error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("quotes_open_opportunity_uidx")
      .on(table.ghl_opportunity_id)
      .where(sql`${table.status} in ('draft', 'sent')`),
    index("quotes_opportunity_idx").on(table.ghl_opportunity_id),
    check(
      "quotes_packed_height_band",
      sql`${table.packed_height_in} >= 36 and ${table.packed_height_in} <= 45`,
    ),
    check(
      "quotes_discount_type",
      sql`${table.discount_type} in ('PERCENTAGE', 'FLAT')`,
    ),
    check(
      "quotes_discount_amount_nonnegative",
      sql`${table.discount_amount} >= 0`,
    ),
    check("quotes_tax_amount_nonnegative", sql`${table.tax_amount} >= 0`),
  ],
);

/** SKU lines on a quote. Freight is a header total, not a line. */
export const quote_line_items = pgTable(
  "quote_line_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quote_id: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    line_no: integer("line_no").notNull(),
    line_kind: quoteLineKindEnum("line_kind").notNull(),
    sku: text("sku").notNull(),
    /** Null on custom lines, which are not catalog or Katana variants. */
    katana_variant_id: integer("katana_variant_id"),
    qty: numeric("qty", { precision: 12, scale: 4 }).notNull(),
    unit_price: numeric("unit_price", { precision: 12, scale: 2 }),
    price_error: text("price_error"),
    description: text("description").notNull(),
    inventory_hold_id: uuid("inventory_hold_id").references(
      () => inventory_holds.id,
    ),
    weight_lb: numeric("weight_lb", { precision: 12, scale: 4 }),
    ltl_class: varchar("ltl_class", { length: 8 }),
    length_in: numeric("length_in", { precision: 12, scale: 4 }),
    width_in: numeric("width_in", { precision: 12, scale: 4 }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("quote_line_items_quote_line_uidx").on(
      table.quote_id,
      table.line_no,
    ),
    index("quote_line_items_quote_idx").on(table.quote_id),
    index("quote_line_items_hold_idx")
      .on(table.inventory_hold_id)
      .where(sql`${table.inventory_hold_id} is not null`),
    check("quote_line_items_qty_positive", sql`${table.qty} > 0`),
  ],
);

/**
 * Immutable send snapshot. The only update is `voided_at` when a sent
 * quote returns to draft. The browser never queries this table.
 */
export const quote_revisions = pgTable(
  "quote_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quote_id: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    revision_no: integer("revision_no").notNull(),
    payload: jsonb("payload").notNull(),
    merchandise_total: numeric("merchandise_total", {
      precision: 12,
      scale: 2,
    }).notNull(),
    freight_total: numeric("freight_total", { precision: 12, scale: 2 }).notNull(),
    deposit_pct: numeric("deposit_pct", { precision: 5, scale: 2 }).notNull(),
    amount_due: numeric("amount_due", { precision: 12, scale: 2 }).notNull(),
    voided_at: timestamp("voided_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("quote_revisions_quote_revision_uidx").on(
      table.quote_id,
      table.revision_no,
    ),
  ],
);

/**
 * Insert-only manager overrides. A later row replaces the shown value.
 * The browser never queries this table.
 */
export const quote_overrides = pgTable(
  "quote_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quote_id: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    field: quoteOverrideFieldEnum("field").notNull(),
    inventory_hold_id: uuid("inventory_hold_id").references(
      () => inventory_holds.id,
    ),
    calculated_value: text("calculated_value").notNull(),
    override_value: text("override_value"),
    reason: text("reason").notNull(),
    actor_id: uuid("actor_id").notNull(),
    actor_role: text("actor_role").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("quote_overrides_quote_idx").on(table.quote_id),
    check(
      "quote_overrides_reason_length",
      sql`char_length(${table.reason}) between 1 and 500`,
    ),
    check(
      "quote_overrides_actor_role",
      sql`${table.actor_role} in ('Ops_Manager', 'SuperAdmin')`,
    ),
  ],
);

/**
 * One measured dock-to-ZIP distance. Reused for 30 days.
 * A manager mile override is stored on the quote, not in this cache.
 */
export const dock_distances = pgTable(
  "dock_distances",
  {
    dest_zip: char("dest_zip", { length: 5 }).primaryKey(),
    origin_zip: char("origin_zip", { length: 5 }).notNull().default("85260"),
    distance_miles: numeric("distance_miles", { precision: 8, scale: 2 }).notNull(),
    source: text("source").notNull().default("geocode"),
    fetched_at: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("dock_distances_miles_nonnegative", sql`${table.distance_miles} >= 0`),
    check("dock_distances_source_geocode", sql`${table.source} = 'geocode'`),
  ],
);

/**
 * Priority1 / fleet plan keyed by the freight input hash.
 * Success rows last 20 minutes. Failure rows last 60 seconds.
 */
export const freight_rate_cache = pgTable("freight_rate_cache", {
  input_hash: char("input_hash", { length: 64 }).primaryKey(),
  dest_zip: char("dest_zip", { length: 5 }).notNull(),
  plan: jsonb("plan"),
  error: text("error"),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Outbound catalog fan-out status per hub SKU × spoke. */
export const channelSyncStatusEnum = pgEnum("channel_sync_status", [
  "pending",
  "success",
  "failed",
]);

export type ChannelSyncStatus =
  (typeof channelSyncStatusEnum.enumValues)[number];

export const channelSyncChannelEnum = pgEnum("channel_sync_channel", [
  "katana",
  "woocommerce",
  "clover",
]);

export type ChannelSyncChannel =
  (typeof channelSyncChannelEnum.enumValues)[number];

export const channel_sync = pgTable(
  "channel_sync",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    global_sku: text("global_sku")
      .notNull()
      .references(() => sku_mappings.global_sku, {
        onUpdate: "cascade",
        onDelete: "cascade",
      }),
    channel: channelSyncChannelEnum("channel").notNull(),
    external_id: varchar("external_id", { length: 255 }),
    status: channelSyncStatusEnum("status").notNull().default("pending"),
    last_error: text("last_error"),
    /** SHA-256 of spoke payload; success + matching hash → Inngest step no-op. */
    payload_hash: varchar("payload_hash", { length: 64 }),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("channel_sync_sku_channel_uidx").on(
      table.global_sku,
      table.channel,
    ),
  ],
);

/**
 * Idempotent ingress log for async webhook / queue processing.
 */
export const incoming_webhooks = pgTable("incoming_webhooks", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: text("source", { enum: ["woocommerce", "ghl"] }).notNull(),
  event_name: text("event_name").notNull(),
  idempotency_key: text("idempotency_key").notNull().unique(),
  payload: jsonb("payload").notNull(),
  status: text("status", {
    enum: ["received", "processed", "failed", "duplicate"],
  })
    .notNull()
    .default("received"),
  error_message: text("error_message"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

/** Dead-letter for webhook payloads that fail Zod SKU validation. */
export const quarantined_orders = pgTable("quarantined_orders", {
  id: serial("id").primaryKey(),
  source: text("source", { enum: ["woocommerce", "ghl"] }).notNull(),
  external_id: text("external_id").notNull(),
  raw_payload: jsonb("raw_payload").notNull(),
  issues: jsonb("issues").notNull(),
  status: text("status", {
    enum: ["pending_review", "resolved", "discarded"],
  })
    .default("pending_review")
    .notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

/** Local Katana MO index — unique external_ref for retry idempotency. */
export const katana_mo_records = pgTable("katana_mo_records", {
  id: serial("id").primaryKey(),
  external_ref: text("external_ref").notNull().unique(),
  katana_mo_id: text("katana_mo_id").notNull(),
  status: text("status").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

/** Registered CC Patio operators (@ccpatio.com) for PIM dictionary access. */
export const pim_operators = pgTable("pim_operators", {
  email: text("email").primaryKey(),
  display_name: text("display_name").notNull(),
  registered_at: timestamp("registered_at").defaultNow().notNull(),
  last_seen_at: timestamp("last_seen_at").defaultNow().notNull(),
});

/** Field-level audit trail — who changed what on which SKU. */
export const pim_audit_log = pgTable("pim_audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  operator_email: text("operator_email").notNull(),
  operator_name: text("operator_name"),
  global_sku: text("global_sku"),
  action: text("action").notNull(),
  field: text("field"),
  old_value: text("old_value"),
  new_value: text("new_value"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

/** Staff feedback and task notes, tied to a SKU and panel context. */
export const staff_notes = pgTable("staff_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  global_sku: text("global_sku"),
  panel_location: text("panel_location").notNull(),
  operator_email: text("operator_email").notNull(),
  note: text("note").notNull(),
  is_urgent: boolean("is_urgent").notNull().default(false),
  status: text("status", { enum: ["pending", "acknowledged", "completed"] })
    .notNull()
    .default("pending"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

/** Mission Control RBAC — maps auth.users UUID to an application role. */
export const user_roles = pgTable("user_roles", {
  id: uuid("id").primaryKey(), // Tied to auth.users.id manually or via trigger
  role: userRoleEnum("role").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Headless CPQ logistics for a Katana variant: packaged dims, NMFC class,
 * and the PrimeView glTF used by the agency configurator.
 * App access is POSTGRES_URL. Data API roles are revoked in the migration.
 */
export const logistics_profiles = pgTable(
  "logistics_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    katana_variant_id: integer("katana_variant_id").notNull().unique(),
    variant_sku: varchar("variant_sku", { length: 128 }).notNull().unique(),
    length_in: numeric("length_in", { precision: 12, scale: 4 }),
    width_in: numeric("width_in", { precision: 12, scale: 4 }),
    height_in: numeric("height_in", { precision: 12, scale: 4 }),
    weight_lb: numeric("weight_lb", { precision: 12, scale: 4 }),
    ltl_class: varchar("ltl_class", { length: 8 }),
    asset_3d_url: text("asset_3d_url"),
    is_modular_component: boolean("is_modular_component")
      .notNull()
      .default(false),
    /** Calendar days after executed-by before a configured line can ship. Null blocks the promise. */
    lead_time_days: integer("lead_time_days"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "logistics_profiles_dims_positive",
      sql`(
        (${table.length_in} is null or ${table.length_in} > 0) and
        (${table.width_in} is null or ${table.width_in} > 0) and
        (${table.height_in} is null or ${table.height_in} > 0) and
        (${table.weight_lb} is null or ${table.weight_lb} > 0)
      )`,
    ),
    check(
      "logistics_profiles_ltl_class_known",
      sql`${table.ltl_class} is null or ${table.ltl_class} in ('50', '55', '60', '65', '70', '77.5', '85', '92.5', '100', '110', '125', '150', '175', '200', '250', '300', '400', '500')`,
    ),
    check(
      "logistics_profiles_lead_time_nonnegative",
      sql`${table.lead_time_days} is null or ${table.lead_time_days} >= 0`,
    ),
  ],
);

/**
 * ZIP to delivery zone. Coordinates are filled when a zone row is created.
 * The browser never queries this table.
 */
export const delivery_zones = pgTable(
  "delivery_zones",
  {
    zip5: char("zip5", { length: 5 }).primaryKey(),
    zone_code: text("zone_code").notNull(),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("delivery_zones_zone_code_idx").on(table.zone_code)],
);

/**
 * Truck-day capacity for a zone. A promise reads remaining room and does not book it.
 * The browser never queries this table.
 */
export const delivery_days = pgTable(
  "delivery_days",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    service_date: date("service_date").notNull(),
    truck_code: text("truck_code").notNull(),
    zone_code: text("zone_code").notNull(),
    capacity_stops: integer("capacity_stops").notNull(),
    capacity_weight_lb: numeric("capacity_weight_lb", {
      precision: 12,
      scale: 2,
    }).notNull(),
    stops_booked: integer("stops_booked").notNull().default(0),
    weight_booked_lb: numeric("weight_booked_lb", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0"),
  },
  (table) => [
    uniqueIndex("delivery_days_truck_day_uidx").on(
      table.service_date,
      table.truck_code,
      table.zone_code,
    ),
    check(
      "delivery_days_capacity_stops_positive",
      sql`${table.capacity_stops} > 0`,
    ),
    check(
      "delivery_days_capacity_weight_positive",
      sql`${table.capacity_weight_lb} > 0`,
    ),
    check(
      "delivery_days_stops_booked_band",
      sql`${table.stops_booked} >= 0 and ${table.stops_booked} <= ${table.capacity_stops}`,
    ),
    check(
      "delivery_days_weight_booked_nonnegative",
      sql`${table.weight_booked_lb} >= 0`,
    ),
  ],
);

export type LogisticsProfile = typeof logistics_profiles.$inferSelect;
export type NewLogisticsProfile = typeof logistics_profiles.$inferInsert;

/**
 * Singleton delivery-fee controls for hybrid fulfillment.
 * id is always 1. App access is POSTGRES_URL.
 * Data API roles are revoked in the migration.
 */
export const logistics_settings = pgTable(
  "logistics_settings",
  {
    id: integer("id").primaryKey().default(1),
    local_white_glove_fee: numeric("local_white_glove_fee", {
      precision: 10,
      scale: 2,
    })
      .notNull()
      .default("150.00"),
    local_radius_miles: integer("local_radius_miles").notNull().default(50),
    fleet_max_radius_miles: integer("fleet_max_radius_miles")
      .notNull()
      .default(500),
    ltl_handling_markup_pct: numeric("ltl_handling_markup_pct", {
      precision: 6,
      scale: 2,
    })
      .notNull()
      .default("15.00"),
    fleet_base_fee: numeric("fleet_base_fee", { precision: 10, scale: 2 }),
    fleet_per_mile: numeric("fleet_per_mile", { precision: 10, scale: 2 }),
    fleet_per_pound: numeric("fleet_per_pound", { precision: 10, scale: 4 }),
    fleet_transit_days: integer("fleet_transit_days").notNull().default(1),
    deposit_pct: numeric("deposit_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("50.00"),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("logistics_settings_singleton", sql`${table.id} = 1`),
    check(
      "logistics_settings_fees_nonnegative",
      sql`${table.local_white_glove_fee} >= 0 and ${table.ltl_handling_markup_pct} >= 0`,
    ),
    check(
      "logistics_settings_radii_ordered",
      sql`${table.local_radius_miles} > 0 and ${table.fleet_max_radius_miles} >= ${table.local_radius_miles}`,
    ),
    check(
      "logistics_settings_fleet_fees_nonnegative",
      sql`(
        (${table.fleet_base_fee} is null or ${table.fleet_base_fee} >= 0) and
        (${table.fleet_per_mile} is null or ${table.fleet_per_mile} >= 0) and
        (${table.fleet_per_pound} is null or ${table.fleet_per_pound} >= 0)
      )`,
    ),
    check(
      "logistics_settings_fleet_transit_nonnegative",
      sql`${table.fleet_transit_days} >= 0`,
    ),
    check(
      "logistics_settings_deposit_pct_band",
      sql`${table.deposit_pct} > 0 and ${table.deposit_pct} <= 100`,
    ),
  ],
);

export type LogisticsSettingsRow = typeof logistics_settings.$inferSelect;
export type NewLogisticsSettingsRow = typeof logistics_settings.$inferInsert;

/** Mission Control Vault — encrypted API keys for vendors. */
export const vendor_credentials = pgTable("vendor_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  service_name: varchar("service_name", { length: 255 }).notNull().unique(), // e.g. 'katana', 'woocommerce'
  encrypted_token: text("encrypted_token").notNull(), // pgsodium transparent encryption target
  updated_by: uuid("updated_by").references(() => user_roles.id),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * E-Commerce roster (Master Catalog blueprint) — one row per Katana roster
 * product name whose hub SKU exists in sku_mappings. A hub SKU can back several
 * listings (e.g. FIN-TJM-MIS), so global_sku is a non-unique FK and identity is
 * the uuid `id`. product_name is the raw workbook name (NOT normalized: two
 * armless-sofa names differ only by whitespace and carry different prices) and
 * is the seed upsert target.
 */
export const ecommerce_listings = pgTable(
  "ecommerce_listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    global_sku: text("global_sku")
      .notNull()
      .references(() => sku_mappings.global_sku, { onUpdate: "cascade" }),
    /** Workbook Original Name / Memo (raw). */
    product_name: text("product_name").notNull(),
    /** Grid price (steel frame). Edited here, not on finished_goods_catalog. */
    steel_msrp: numeric("steel_msrp", { precision: 10, scale: 2 }),
    legacy_base_sku: text("legacy_base_sku"),
    /** True when another listing uses the same legacy base SKU. */
    legacy_sku_shared: boolean("legacy_sku_shared").notNull().default(false),
    /** True when another listing uses the same canonical hub SKU. */
    canonical_sku_shared: boolean("canonical_sku_shared")
      .notNull()
      .default(false),
    product_url: text("product_url"),
    /** 'row' | 'sibling' | 'missing' */
    url_source: text("url_source").notNull().default("missing"),
    /** True once an operator saved product_url inline; the seed must keep it. */
    url_operator_set: boolean("url_operator_set").notNull().default(false),
    /** True once an operator saved legacy_base_sku inline; the seed must keep it. */
    legacy_operator_set: boolean("legacy_operator_set").notNull().default(false),
    /** Product-type facet (workbook Drawing section header). */
    drawing_section: text("drawing_section").notNull(),
    collection_label: text("collection_label").notNull(),
    aluminum_msrp: numeric("aluminum_msrp", { precision: 10, scale: 2 }),
    marketing_description: text("marketing_description"),
    construction_details: text("construction_details"),
    seo_title: text("seo_title"),
    seo_description: text("seo_description"),
    slug: text("slug"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    sheet_order: integer("sheet_order").notNull(),
    sale_price: numeric("sale_price", { precision: 10, scale: 2 }),
    sale_ends_at: timestamp("sale_ends_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    archived_at: timestamp("archived_at"),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("ecommerce_listings_global_sku_idx").on(table.global_sku),
    uniqueIndex("ecommerce_listings_product_name_uidx").on(table.product_name),
    /** Slugs are unique among live (non-archived) listings. */
    uniqueIndex("ecommerce_listings_slug_active_uidx")
      .on(table.slug)
      .where(sql`${table.archived_at} IS NULL AND ${table.slug} IS NOT NULL`),
  ],
);

/**
 * Roster names whose hub SKU is absent from sku_mappings. Keyed by product_name
 * because several missing names can share one absent hub SKU.
 */
export const ecommerce_roster_gaps = pgTable("ecommerce_roster_gaps", {
  product_name: text("product_name").primaryKey(),
  global_sku: text("global_sku").notNull(),
  reason: text("reason").notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export type EcommerceListingRow = typeof ecommerce_listings.$inferSelect;
export type EcommerceRosterGapRow = typeof ecommerce_roster_gaps.$inferSelect;

export const productAssetKindEnum = pgEnum("product_asset_kind", [
  "tear_sheet",
  "assembly",
  "gallery",
  "primary_image",
  "care_guide",
  "warranty",
]);

export type ProductAssetKind = (typeof productAssetKindEnum.enumValues)[number];

export const product_assets = pgTable(
  "product_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    global_sku: text("global_sku")
      .notNull()
      .references(() => sku_mappings.global_sku, {
        onUpdate: "cascade",
        onDelete: "cascade",
      }),
    kind: productAssetKindEnum("kind").notNull(),
    storage_path: text("storage_path").notNull(),
    original_filename: text("original_filename").notNull(),
    content_type: text("content_type").notNull(),
    byte_size: integer("byte_size").notNull(),
    revision: integer("revision").notNull().default(1),
    sha256: text("sha256"),
    effective_on: date("effective_on", { mode: 'string' }).defaultNow().notNull(),
    is_current: boolean("is_current").notNull().default(true),
    superseded_at: timestamp("superseded_at"),
    sort_order: integer("sort_order"),
    alt_text: text("alt_text"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("product_assets_global_sku_idx").on(table.global_sku),
    index("product_assets_kind_idx").on(table.kind),
    // One current revision per (sku, kind) for every kind except gallery.
    uniqueIndex("product_assets_one_current_uidx")
      .on(table.global_sku, table.kind)
      .where(sql`${table.is_current} AND ${table.kind} <> 'gallery'`),
    // Revision numbers are unique per (sku, kind) for every kind except gallery.
    uniqueIndex("product_assets_revision_uidx")
      .on(table.global_sku, table.kind, table.revision)
      .where(sql`${table.kind} <> 'gallery'`),
  ]
);

export type ProductAssetRow = typeof product_assets.$inferSelect;








export const nomenclature_collections = pgTable("nomenclature_collections", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // ^[A-Z0-9]{2,4}$
  label: text("label").notNull().unique(),
  aliases: text("aliases").array(),
  is_active: boolean("is_active").notNull().default(true),
  created_by: text("created_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const nomenclature_categories = pgTable("nomenclature_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // ^[A-Z0-9]+(-[A-Z0-9]+)*$ max 24
  label: text("label").notNull().unique(),
  aliases: text("aliases").array(),
  is_active: boolean("is_active").notNull().default(true),
  created_by: text("created_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const nomenclature_sku_tokens = pgTable("nomenclature_sku_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // ^[A-Z0-9-]+$ max 24
  label: text("label").notNull(),
  is_active: boolean("is_active").notNull().default(true),
  created_by: text("created_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const thirdPartyFulfillmentEnum = pgEnum("third_party_fulfillment", [
  "showroom_stock",
  "special_order",
]);

export const third_party_sources = pgTable("third_party_sources", {
  global_sku: text("global_sku").primaryKey().references(() => sku_mappings.global_sku, { onUpdate: "cascade", onDelete: "cascade" }),
  vendor_name: text("vendor_name").notNull(),
  vendor_sku: text("vendor_sku").notNull(),
  wholesale_cost: numeric("wholesale_cost", { precision: 12, scale: 4 }).notNull(),
  country_of_origin: text("country_of_origin"),
  fulfillment: thirdPartyFulfillmentEnum("fulfillment"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const shipModeEnum = pgEnum("ship_mode", [
  "ltl",
  "parcel",
  "white_glove_only",
  "not_shipped"
]);

export const catalog_ship_profiles = pgTable("catalog_ship_profiles", {
  global_sku: text("global_sku").primaryKey().references(() => sku_mappings.global_sku, { onUpdate: "cascade", onDelete: "cascade" }),
  length_in: numeric("length_in", { precision: 10, scale: 2 }),
  width_in: numeric("width_in", { precision: 10, scale: 2 }),
  height_in: numeric("height_in", { precision: 10, scale: 2 }),
  weight_lb: numeric("weight_lb", { precision: 10, scale: 2 }),
  dim_weight_lb: numeric("dim_weight_lb", { precision: 10, scale: 2 }),
  billable_weight_lb: numeric("billable_weight_lb", { precision: 10, scale: 2 }),
  ltl_class: text("ltl_class"),
  nmfc_item: text("nmfc_item"),
  ship_mode: shipModeEnum("ship_mode"),
  stackable: boolean("stackable").notNull().default(false),
  assembly_required: boolean("assembly_required").notNull().default(false),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const productRelationRoleEnum = pgEnum("product_relation_role", [
  "composes_with",
  "requires",
  "accessory",
  "successor"
]);

export const product_relations = pgTable("product_relations", {
  id: uuid("id").defaultRandom().primaryKey(),
  from_sku: text("from_sku").notNull().references(() => sku_mappings.global_sku, { onUpdate: "cascade", onDelete: "cascade" }),
  to_sku: text("to_sku").notNull().references(() => sku_mappings.global_sku, { onUpdate: "cascade", onDelete: "cascade" }),
  role: productRelationRoleEnum("role").notNull(),
  note: varchar("note", { length: 200 }),
  created_at: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("product_relations_unq").on(table.from_sku, table.to_sku, table.role),
]);
