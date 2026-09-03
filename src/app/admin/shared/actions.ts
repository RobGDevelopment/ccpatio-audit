"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Resend } from "resend";
import { getDb } from "@/server/db/client";
import { staff_notes, sku_mappings } from "@/server/db/schema";
import { Inngest } from "inngest";
import { inngest } from "@/inngest/client";

const resend = new Resend(process.env.RESEND_API_KEY || "re_placeholder");

export async function submitStaffNote(data: {
  globalSku?: string;
  panelLocation: string;
  note: string;
  isUrgent: boolean;
  operatorEmail: string;
}) {
  const db = getDb();

  // 1. Save to database
  const [newNote] = await db
    .insert(staff_notes)
    .values({
      global_sku: data.globalSku || null,
      panel_location: data.panelLocation,
      note: data.note,
      is_urgent: data.isUrgent,
      operator_email: data.operatorEmail,
    })
    .returning();

  // 2. If urgent, send instant email
  if (data.isUrgent) {
    try {
      await resend.emails.send({
        from: "CC Patio Admin <admin@ccpatio.com>",
        to: "rjg.cal@gmail.com",
        subject: `🚨 URGENT STAFF REQUEST: ${data.operatorEmail}`,
        html: `
          <h2>Urgent Feedback Received</h2>
          <p><strong>From:</strong> ${data.operatorEmail}</p>
          <p><strong>Panel:</strong> ${data.panelLocation}</p>
          <p><strong>SKU Context:</strong> ${data.globalSku || "N/A"}</p>
          <hr />
          <p><strong>Note:</strong></p>
          <p>${data.note}</p>
        `,
      });
    } catch (e) {
      console.error("[StaffNote] Failed to send urgent email", e);
      // We don't throw, we just log it so the UI doesn't crash if Resend key is bad
    }
  }

  // 3. Revalidate the path so the global dropdown picks it up
  revalidatePath("/admin", "layout");

  return { success: true, note: newNote };
}

/**
 * Marks a SKU as discontinued and fires the webhook/Inngest event to archive in Katana.
 */
export async function discontinueSku(globalSku: string, operatorEmail: string) {
  const db = getDb();

  await db
    .update(sku_mappings)
    .set({
      is_active: false,
      updated_by: operatorEmail,
      updated_at: new Date(),
    })
    .where(eq(sku_mappings.global_sku, globalSku));

  // Trigger Katana archive (we use Inngest so it happens in the background reliably)
  // For the immediate MVP, we trigger the webhook simulator or direct event
  await inngest.send({
    name: "katana/variant.archive" as any,
    data: {
      globalSku,
      operatorEmail,
    },
  });

  revalidatePath("/admin", "layout");
  return { success: true };
}

export async function getPendingStaffNotes() {
  const db = getDb();
  return await db.query.staff_notes.findMany({
    where: eq(staff_notes.status, "pending"),
    orderBy: (notes: any, { desc }: any) => [desc(notes.created_at)],
    limit: 50,
  });
}

