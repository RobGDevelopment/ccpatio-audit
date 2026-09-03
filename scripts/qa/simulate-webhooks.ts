import { randomUUID } from 'crypto';

async function simulateKatanaWebhook() {
  console.log('[QA PHASE 4] Simulating Incoming Katana Webhook...');
  
  // Minimal payload representing a Katana webhook
  const payload = {
    webhook_id: randomUUID(),
    action: 'item_created',
    data: {
      item_id: 123456,
      sku: 'TEST-WEBHOOK-1',
      name: 'Test Webhook Item',
      category: 'Raw Material'
    }
  };

  try {
    const res = await fetch('http://localhost:3000/api/webhooks/katana', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`Webhook simulation failed with status ${res.status}: ${await res.text()}`);
    }

    console.log('[SUCCESS] Webhook Simulation Passed');
    process.exit(0);
  } catch (err) {
    console.error('[QA PHASE 4 FAILED]', err);
    process.exit(1);
  }
}

simulateKatanaWebhook();
