import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function run() {
  const token = process.env.KATANA_API_KEY;
  if (!token) {
    console.error("KATANA_API_KEY is missing from environment variables.");
    process.exit(1);
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json"
  };

  const baseUrl = "https://api.katanamrp.com";

  try {
    console.log("Fetching /v1/materials...");
    const matRes = await fetch(`${baseUrl}/v1/materials`, { headers });
    const matText = await matRes.text();
    const material = JSON.parse(matText).data?.[0];

    console.log("\n=================================");
    console.log("=== SINGLE MATERIAL (Item) ===");
    console.log("=================================");
    console.log(JSON.stringify(material, null, 2));

    console.log("\nFetching /v1/products...");
    const prodRes = await fetch(`${baseUrl}/v1/products`, { headers });
    const prodText = await prodRes.text();
    const product = JSON.parse(prodText).data?.[0];

    console.log("\n=================================");
    console.log("===  SINGLE PRODUCT (Item)   ===");
    console.log("=================================");
    console.log(JSON.stringify(product, null, 2));

    console.log("\nFetching /v1/recipes...");
    const recipesRes = await fetch(`${baseUrl}/v1/recipes`, { headers });
    console.log(`Status: ${recipesRes.status} ${recipesRes.statusText}`);
    const recipesText = await recipesRes.text();
    let recipesJson: any = {};
    try {
      recipesJson = JSON.parse(recipesText);
    } catch (e) {
      console.log("Failed to parse JSON for recipes:", recipesText.substring(0, 500));
    }
    const recipe = recipesJson.data?.[0];

    console.log("\n=================================");
    console.log("=== SINGLE RECIPE (BOM) ===");
    console.log("=================================");
    console.log(JSON.stringify(recipe, null, 2));

  } catch (error) {
    console.error("Error fetching from Katana API:", error);
  }
}

run();
