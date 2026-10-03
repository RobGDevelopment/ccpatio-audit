/**
 * Rate the 90x40 skid and print hybrid fulfillment for the same lane.
 *
 *   npm run ops:sandbox-priority1
 *
 * A blank PRIORITY1_API_KEY returns the mocked $250 all-in quote.
 * 400 miles is inside the 500-mile fleet radius and outside local white-glove,
 * so the plan includes the company truck and the Priority1 rate.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import type { FreightSkid } from "../../src/types/freight";

config({ path: resolve(process.cwd(), ".env.local") });

const skid: FreightSkid = {
  items: [
    {
      freightClass: "175",
      weight: 150,
      length: 90,
      width: 40,
      height: 40,
      packagingType: "Pallet",
      isStackable: true,
    },
  ],
};

/** Scottsdale 85260 to Beverly Hills 90210, inside the internal fleet radius. */
const SCOTTSDALE_TO_BEVERLY_HILLS_MILES = 400;

async function main(): Promise<void> {
  const { getPriority1Quote } = await import(
    "../../src/server/freight/priority1"
  );
  const { calculateFulfillmentOptions } = await import(
    "../../src/server/freight/fulfillment"
  );

  const result = await getPriority1Quote(skid, "85260", "90210", [
    "RESDEL",
    "LGDEL",
    "APPT",
  ]);
  const line = result.request.items[0];
  console.log(
    `Rated 1 line item: class ${line.freightClass}, ${line.totalWeight} lb, ${line.length}x${line.width}x${line.height}, stackable=${line.isStackable}, units=${line.units}`,
  );
  console.log(JSON.stringify(result.response, null, 2));

  const plan = await calculateFulfillmentOptions(
    "90210",
    SCOTTSDALE_TO_BEVERLY_HILLS_MILES,
    skid,
  );
  console.log(JSON.stringify(plan, null, 2));
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { closeDb } = await import("../../src/server/db/client");
    await closeDb();
  });
