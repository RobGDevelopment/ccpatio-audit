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

export type ItemType = (typeof itemTypeEnum.enumValues)[number];

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

/**
 * Raw materials catalog — Katana materials, fabrics, powder, aluminum, etc.
 */
export const raw_materials_catalog = pgTable("raw_materials_catalog", {
  id: uuid("id").defaultRandom().primaryKey(),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull().default(""),
  category: text("category").notNull().default(""),
  unit_of_measure: text("unit_of_measure").notNull().default("ea"),
  cost_per_unit: numeric("cost_per_unit", { precision: 12, scale: 4 }),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

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
