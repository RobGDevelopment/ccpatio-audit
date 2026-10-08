const fs = require('fs');
let content = fs.readFileSync('src/server/db/schema.ts', 'utf8');

content = content.replace(
  'export const itemTypeEnum = pgEnum("item_type", [\n  "raw_material",\n  "sub_assembly",\n  "finished_good",\n  "service",\n]);',
  'export const itemTypeEnum = pgEnum("item_type", [\n  "raw_material",\n  "sub_assembly",\n  "finished_good",\n  "service",\n]);\n\nexport const productOriginEnum = pgEnum("product_origin", [\n  "manufactured",\n  "third_party",\n]);'
);
content = content.replace(
  'export const itemTypeEnum = pgEnum("item_type", [\r\n  "raw_material",\r\n  "sub_assembly",\r\n  "finished_good",\r\n  "service",\r\n]);',
  'export const itemTypeEnum = pgEnum("item_type", [\r\n  "raw_material",\r\n  "sub_assembly",\r\n  "finished_good",\r\n  "service",\r\n]);\r\n\r\nexport const productOriginEnum = pgEnum("product_origin", [\r\n  "manufactured",\r\n  "third_party",\r\n]);'
);

content = content.replace(
  'export const sku_mappings = pgTable("sku_mappings", {\n  global_sku: text("global_sku").primaryKey(),\n  category: text("category").notNull(),',
  'export const sku_mappings = pgTable("sku_mappings", {\n  global_sku: text("global_sku").primaryKey(),\n  product_origin: productOriginEnum("product_origin"),\n  category: text("category").notNull(),'
);
content = content.replace(
  'export const sku_mappings = pgTable("sku_mappings", {\r\n  global_sku: text("global_sku").primaryKey(),\r\n  category: text("category").notNull(),',
  'export const sku_mappings = pgTable("sku_mappings", {\r\n  global_sku: text("global_sku").primaryKey(),\r\n  product_origin: productOriginEnum("product_origin"),\r\n  category: text("category").notNull(),'
);

content = content.replace(
  '  version: integer("version").notNull().default(1),\n  updated_by: text("updated_by"),\n  updated_at: timestamp("updated_at").defaultNow().notNull(),\n});',
  '  version: integer("version").notNull().default(1),\n  updated_by: text("updated_by"),\n  updated_at: timestamp("updated_at").defaultNow().notNull(),\n}, (table) => [\n  check(\n    "origin_check",\n    sql`(product_origin = \'manufactured\' AND global_sku LIKE \'FIN-%\') OR (product_origin = \'third_party\' AND global_sku LIKE \'3P-%\') OR (product_origin IS NULL)`\n  )\n]);'
);
content = content.replace(
  '  version: integer("version").notNull().default(1),\r\n  updated_by: text("updated_by"),\r\n  updated_at: timestamp("updated_at").defaultNow().notNull(),\r\n});',
  '  version: integer("version").notNull().default(1),\r\n  updated_by: text("updated_by"),\r\n  updated_at: timestamp("updated_at").defaultNow().notNull(),\r\n}, (table) => [\r\n  check(\r\n    "origin_check",\r\n    sql`(product_origin = \\\'manufactured\\\' AND global_sku LIKE \\\'FIN-%\\\') OR (product_origin = \\\'third_party\\\' AND global_sku LIKE \\\'3P-%\\\') OR (product_origin IS NULL)`\r\n  )\r\n]);'
);


fs.writeFileSync('src/server/db/schema.ts', content);
