const fs = require('fs');
let code = fs.readFileSync('src/server/db/schema.ts', 'utf8');

const imports = [
  'import {\n  boolean,\n  check,\n  index,\n  integer,\n  jsonb,\n  numeric,\n  pgEnum,\n  pgTable,\n  text,\n  timestamp,\n  uniqueIndex,\n  uuid,\n  varchar,\n} from "drizzle-orm/pg-core";',
  'import {\r\n  boolean,\r\n  check,\r\n  index,\r\n  integer,\r\n  jsonb,\r\n  numeric,\r\n  pgEnum,\r\n  pgTable,\r\n  text,\r\n  timestamp,\r\n  uniqueIndex,\r\n  uuid,\r\n  varchar,\r\n} from "drizzle-orm/pg-core";',
  'import { sql } from "drizzle-orm";',
  'export const productOriginEnum = pgEnum("product_origin", [\n  "manufactured",\n  "third_party",\n]);',
  'export const productOriginEnum = pgEnum("product_origin", [\r\n  "manufactured",\r\n  "third_party",\r\n]);'
];

for (const imp of imports) {
  const lastIdx = code.lastIndexOf(imp);
  if (lastIdx > 1000) { // meaning it's at the bottom where we appended
    code = code.substring(0, lastIdx) + code.substring(lastIdx + imp.length);
  }
}

fs.writeFileSync('src/server/db/schema.ts', code);
