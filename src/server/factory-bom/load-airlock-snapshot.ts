import { getDb } from "../db/client";
import {
  product_bom_draft,
  item_operations_draft,
  cad_uploads,
  factory_release_gate,
  sku_mappings,
} from "../db/schema";
import { eq, inArray, desc, sql } from "drizzle-orm";

export type AirlockSnapshot = {
  rootSku: string;
  lines: (typeof product_bom_draft.$inferSelect)[];
  operations: (typeof item_operations_draft.$inferSelect)[];
  cadUpload: (typeof cad_uploads.$inferSelect) | null;
  releaseGate: (typeof factory_release_gate.$inferSelect) | null;
};

// Adapted from actions.ts collectDraftParents to get the full tree
async function collectDraftParents(rootSku: string, db: ReturnType<typeof getDb>): Promise<string[]> {
  const found = new Set<string>([rootSku]);
  const queue = [rootSku];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const kids = await db
      .select({ child: product_bom_draft.child_sku, type: sku_mappings.item_type })
      .from(product_bom_draft)
      .leftJoin(sku_mappings, eq(product_bom_draft.child_sku, sku_mappings.global_sku))
      .where(eq(product_bom_draft.parent_sku, current));
    for (const kid of kids) {
      if (kid.type === "sub_assembly" && !found.has(kid.child)) {
        found.add(kid.child);
        queue.push(kid.child);
      }
    }
  }
  return [...found];
}

export async function loadAirlockSnapshot(globalSku: string): Promise<AirlockSnapshot> {
  const db = getDb();
  
  const parents = await collectDraftParents(globalSku, db);

  const lines = await db
    .select()
    .from(product_bom_draft)
    .where(inArray(product_bom_draft.parent_sku, parents));

  const operations = await db
    .select()
    .from(item_operations_draft)
    .where(inArray(item_operations_draft.item_sku, parents));

  const [cadUpload = null] = await db
    .select()
    .from(cad_uploads)
    .where(
      sql`${cad_uploads.global_sku} = ${globalSku} AND ${cad_uploads.ext} IN ('dae', 'glb')`
    )
    .orderBy(desc(cad_uploads.created_at))
    .limit(1);

  const [releaseGate = null] = await db
    .select()
    .from(factory_release_gate)
    .where(eq(factory_release_gate.root_sku, globalSku))
    .limit(1);

  return {
    rootSku: globalSku,
    lines,
    operations,
    cadUpload,
    releaseGate,
  };
}
