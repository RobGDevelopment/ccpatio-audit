import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("[KATANA WEBHOOK] Received:", body);
    return NextResponse.json({ accepted: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
}
