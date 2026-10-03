import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Handle Clover Setup Verification Ping
  if (body.verificationCode) {
    console.log(`[CLOVER SETUP] 🟢 VERIFICATION CODE: ${body.verificationCode}`);
    return NextResponse.json({ success: true }, { status: 200 });
  }

  // Enforce Signature/Header validation
  const authHeader = req.headers.get("x-clover-auth");
  const secret = process.env.CLOVER_WEBHOOK_SECRET;

  if (!secret || authHeader !== secret) {
    console.error("[CLOVER WEBHOOK] 🔴 Unauthorized or Missing Secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse Merchants & Events
  const merchants = body.merchants;
  if (!merchants || typeof merchants !== "object") {
    // If it's something else, return 200 to acknowledge but ignore
    return NextResponse.json({ success: true, ignored: true }, { status: 200 });
  }

  // Dispatch Inngest events for valid CREATE payments
  const eventsToDispatch = [];

  for (const [merchantId, events] of Object.entries(merchants)) {
    if (!Array.isArray(events)) continue;

    for (const event of events) {
      if (event.type === "CREATE" && event.objectId && event.objectId.startsWith("P:")) {
        eventsToDispatch.push({
          name: "clover/payment.created",
          data: {
            merchantId,
            paymentId: event.objectId,
          },
        });
      }
    }
  }

  if (eventsToDispatch.length > 0) {
    await inngest.send(eventsToDispatch);
    console.log(`[CLOVER WEBHOOK] 🟢 Dispatched ${eventsToDispatch.length} payment(s) to Inngest`);
  }

  // Always immediately return 200 to keep the webhook fast
  return NextResponse.json({ success: true }, { status: 200 });
}
