/**
 * Drizzle schema for middleware persistence.
 *
 * ORM choice: Drizzle (already configured in this repo via topology/;
 * V8 rules explicitly exclude Prisma). These tables live in the same
 * Postgres instance (POSTGRES_URL).
 */
import {
  boolean,
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
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/** Manufacturing / BOM role — orthogonal to display `category`. */
export const itemTypeEnum = pgEnum("item_type", [
  "raw_material",
  "sub_assembly",
  "finished_good",
  "service",
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
});

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
  /** Operator / device label for multi-browser audit trail. */
  updated_by: text("updated_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
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
 */
export const item_operations = pgTable("item_operations", {
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
});

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
  carton_lwh_in: jsonb("carton_lwh_in")
    .$type<{ l: number; w: number; h: number } | null>()
    .default(null),
  packaging_bom: jsonb("packaging_bom")
    .$type<Record<string, unknown> | null>()
    .default(null),
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
});

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
});

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

/** Mission Control Vault — encrypted API keys for vendors. */
export const vendor_credentials = pgTable("vendor_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  service_name: varchar("service_name", { length: 255 }).notNull().unique(), // e.g. 'katana', 'woocommerce'
  encrypted_token: text("encrypted_token").notNull(), // pgsodium transparent encryption target
  updated_by: uuid("updated_by").references(() => user_roles.id),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});
