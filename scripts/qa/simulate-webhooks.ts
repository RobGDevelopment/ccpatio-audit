/**
 * QA Phase 4 — prove retired Katana ingress returns HTTP 410 Gone.
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md (PR-T2.1).
 */
async function simulateKatanaWebhook() {
  console.log("[QA PHASE 4] Simulating Incoming Katana Webhook (expect 410 Gone)...");

  try {
    const res = await fetch("http://localhost:3000/api/webhooks/katana", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "item_created",
        data: { sku: "TEST-WEBHOOK-1" },
      }),
    });

    if (res.status !== 410) {
      throw new Error(
        `Expected 410 Gone, got ${res.status}: ${await res.text()}`,
      );
    }

    const body = (await res.json()) as { error?: string };
    if (body.error !== "transactional_ingress_retired") {
      throw new Error(
        `Expected error transactional_ingress_retired, got: ${JSON.stringify(body)}`,
      );
    }

    console.log("[SUCCESS] Webhook Simulation Passed (410 Gone)");
    process.exit(0);
  } catch (err) {
    console.error("[QA PHASE 4 FAILED]", err);
    process.exit(1);
  }
}

simulateKatanaWebhook();
