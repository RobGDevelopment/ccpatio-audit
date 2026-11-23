/**
 * Verify Fly Leg odd-dollar Mia spot-check is scoped to woo_sku
 * FIN-WFT-FLY-BST-18X18-CNT only.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { needsMiaSpotCheck } from "../../src/server/ecommerce/two-tab-portal";

const CNT = "FIN-WFT-FLY-BST-18X18-CNT";
const BAR = "FIN-WFT-FLY-BST-18X18-BAR";
const BASE = "FIN-WFT-FLY-BST-18X18";

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL required");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5 });

  const rows = await sql`
    SELECT el.woo_sku, el.global_sku, sm.attributes
    FROM ecommerce_listings el
    JOIN sku_mappings sm ON sm.global_sku = el.global_sku
    WHERE upper(el.woo_sku) IN (${CNT}, ${BAR})
      AND el.archived_at IS NULL
  `;

  let spot = 0;
  for (const row of rows) {
    const attrs = (row.attributes ?? {}) as Record<string, unknown>;
    const hit = needsMiaSpotCheck({
      globalSku: String(row.global_sku),
      attributes: attrs,
      wooSku: String(row.woo_sku),
    });
    console.log({ woo: row.woo_sku, spot: hit });
    if (hit) spot += 1;
  }

  const barHit = needsMiaSpotCheck({
    globalSku: BASE,
    attributes: { price_review_flag: "odd_dollar_in_pdf", mia_phase1_approved: true },
    wooSku: BAR,
  });
  const cntHit = needsMiaSpotCheck({
    globalSku: BASE,
    attributes: { price_review_flag: "odd_dollar_in_pdf", mia_phase1_approved: true },
    wooSku: CNT,
  });
  if (barHit) throw new Error("BAR must not need Mia spot-check");
  if (!cntHit) throw new Error("CNT must need Mia spot-check");
  console.log("logic_ok", { barHit, cntHit, dbSpotAmongBarCnt: spot });

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
