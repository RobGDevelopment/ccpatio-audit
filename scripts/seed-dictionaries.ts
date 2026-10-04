import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { nomenclature_collections, nomenclature_categories } from "../src/server/db/schema";
import { eq, sql } from "drizzle-orm";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const COLLECTION_CODES: ReadonlyArray<[string, string]> = [
  ["BRAVADA", "BRV"],
  ["BROOKLYN", "BRK"],
  ["OCEAN", "OCN"],
  ["MILAN", "MLN"],
  ["MARINA", "MLN"],
  ["TENJAM", "TJM"],
  ["TAYLOR", "TAY"],
  ["WATERFALL", "WFT"],
  ["FLEXY", "ESY"],
  ["EASY", "ESY"],
  ["FLY", "FLY"],
  ["DAISY", "DAI"],
  ["CUSTOM", "CUS"],
  ["STANDARD", "STA"],
  ["TRIANGLE", "TRI"],
  ["KING", "KIN"],
  ["LED", "LED"],
  ["FLEX", "FLE"],
  ["CANTILEVER", "CTL"],
  ["CANOPY", "CAN"],
  ["OCCASIONAL", "OCC"],
  ["CABANA", "CAB"],
];

const CATEGORY_RULES: ReadonlyArray<[RegExp, string, string]> = [
  [/UMBRELLA/i, "UMB", "Umbrella"],
  [/SWIVEL\s+BARSTOOL|BARSTOOL[^)]*SWIVEL/i, "SWV-BST", "Swivel Barstool"],
  [/SWIVEL\s+CHAIR|CHAIR[^)]*SWIVEL/i, "SWV-CHA", "Swivel Chair"],
  [/TRANSITIONAL\s+DOUBLE\s+CHAISE/i, "TRA-DOU-CHS", "Transitional Double Chaise"],
  [/TRANSITIONAL\s+SINGLE\s+CHAISE/i, "TRA-SGL-CHS", "Transitional Single Chaise"],
  [/DOUBLE\s+CHAISE/i, "DOU-CHS", "Double Chaise"],
  [/SINGLE\s+CHAISE(?:\s+LOUNGE)?/i, "SGL-CHS", "Single Chaise"],
  [/OVERSIZED\s+CHAISE/i, "OVS-CHS", "Oversized Chaise"],
  [/CORNER\s+SOFA/i, "COR-SOF", "Corner Sofa"],
  [/CORNER\s+CHAISE/i, "COR-CHS", "Corner Chaise"],
  [/ARMLESS\s+SOFA/i, "ARM-SOF", "Armless Sofa"],
  [/ARMLESS\s+LOVESEAT/i, "ARM-LOV", "Armless Loveseat"],
  [/MINI\s+LOVESEAT/i, "MIN-LOV", "Mini Loveseat"],
  [/LOVESEAT/i, "LOV-SOF", "Loveseat"],
  [/\bSOFA\b/i, "SOF", "Sofa"],
  [/DAYBED/i, "DYB", "Daybed"],
  [/CLUB\s+CHAIR/i, "CLB-CHA", "Club Chair"],
  [/HALF\s+BACK\s+BARSTOOL|FLY\s+LEG\s+BARSTOOL/i, "FLY-BST", "Fly Barstool"],
  [/BARSTOOL/i, "BST", "Barstool"],
  [/DINING\s+BENCH/i, "DIN-BCH", "Dining Bench"],
  [/\bBENCH\b/i, "BCH", "Bench"],
  [/OTTOMAN/i, "OTT", "Ottoman"],
  [/COFFEE\s+TABLE/i, "COF-TAB", "Coffee Table"],
  [/FIRE\s+PIT\s+(?:DINING\s+)?TABLE/i, "FIR-TAB", "Fire Table"],
  [/SIDE\s+TABLE/i, "SID-TAB", "Side Table"],
  [/TABLE\s*\(DINING\s+HEIGHT\)|DINING\s+TABLE/i, "DIN-TAB", "Dining Table"],
  [
    /ROUND\s+TABLE.*\(BAR\s+HEIGHT\)|TABLE\s*\(BAR\s+HEIGHT\).*ROUND|ROUND\s+(?:SIDE\s+)?TABLE/i,
    "RND-TAB",
    "Round Table",
  ],
  [/TABLE\s*\(BAR\s+HEIGHT\)|BAR\s+HEIGHT\s*\)\s*\d/i, "BAR-TAB", "Bar Table"],
  [/TABLE\s*\(COUNTER\s+HEIGHT\)/i, "CNT-TAB", "Counter Table"],
  [
    /CHAIR\s*\(DINING\s+HEIGHT\)|CHAIR[^)]*DINING\s+HEIGHT|DINING\s+HEIGHT[^)]*CHAIR/i,
    "DIN-CHA",
    "Dining Chair",
  ],
  [/SWING(?:\s+FRAME\s+ONLY)?/i, "SWG", "Swing"],
  [/CHAISE/i, "CHS", "Chaise"],
  [/\bTABLE\b/i, "TAB", "Table"],
  [/\bCHAIR\b/i, "CHA", "Chair"],
];

type DictTable = typeof nomenclature_collections | typeof nomenclature_categories;

/**
 * Insert (code,label). If the code already exists with a different label, the
 * new label is appended to that row's `aliases` array (case-insensitive dedupe)
 * instead of being dropped by the unique(code) constraint.
 */
async function upsertWithAlias(
  db: ReturnType<typeof drizzle>,
  table: DictTable,
  code: string,
  label: string,
) {
  const [existing] = await db
    .select({ label: table.label, aliases: table.aliases })
    .from(table)
    .where(eq(table.code, code))
    .limit(1);

  if (!existing) {
    await db
      .insert(table)
      .values({ code, label, created_by: "system_seed" })
      .onConflictDoNothing();
    return;
  }

  const known = [existing.label, ...(existing.aliases ?? [])].map((s) => s.toLowerCase());
  if (known.includes(label.toLowerCase())) return;

  await db
    .update(table)
    .set({ aliases: sql`array_append(coalesce(${table.aliases}, ARRAY[]::text[]), ${label})` })
    .where(eq(table.code, code));
  console.log(`  alias: ${code} (${existing.label}) += ${label}`);
}

async function seed() {
  const queryClient = postgres(process.env.POSTGRES_URL as string);
  const db = drizzle(queryClient);

  console.log("Seeding collections...");
  for (const [label, code] of COLLECTION_CODES) {
    const titleCaseLabel = label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
    await upsertWithAlias(db, nomenclature_collections, code, titleCaseLabel);
  }

  console.log("Seeding categories...");
  for (const [_, code, label] of CATEGORY_RULES) {
    await upsertWithAlias(db, nomenclature_categories, code, label);
  }

  console.log("Seed complete.");
  await queryClient.end();
}

seed().catch(console.error);
