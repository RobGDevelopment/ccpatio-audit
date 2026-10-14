import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { describePathASaga } from "@/server/path-a/saga-state";
import { hasOverrideAuthority } from "@/server/path-a/authz";
import type { PimSession } from "@/lib/pim-audit";

describe("Path A Status UI / View-Model Tests", () => {
  const baseTime = new Date("2026-10-13T12:00:00Z");

  it("generates correct view-model for AWAITING_DEPOSIT without request", () => {
    const row = {
      status: "AWAITING_DEPOSIT",
      current_step: "awaiting_deposit_or_override",
      created_at: new Date(baseTime.getTime() - 47 * 24 * 60 * 60 * 1000),
      updated_at: new Date(baseTime.getTime() - 47 * 24 * 60 * 60 * 1000),
    };
    const vm = describePathASaga(row, [{ design_status: "finalized" }], baseTime);

    expect(vm.label).toBe("Awaiting Deposit");
    expect(vm.tone).toBe("amber");
    expect(vm.ageDays).toBe(47);
    expect(vm.canOverride).toBe(true);
    expect(vm.canRetryRelease).toBe(false);

    // Mandate D6: No deadline, overdue, or countdown in view-model
    expect((vm as any).deadline).toBeUndefined();
    expect((vm as any).countdown).toBeUndefined();
    expect((vm as any).isOverdue).toBeUndefined();
  });

  it("locks override if release is already requested by override or deposit", () => {
    const rowOverride = {
      status: "AWAITING_DEPOSIT",
      current_step: "awaiting_deposit_or_override",
      release_requested_at: new Date(baseTime.getTime() - 1000),
      release_source: "management_override",
      release_requested_by: "manager@ccpatio.com",
      created_at: baseTime,
      updated_at: baseTime,
    };
    const vm1 = describePathASaga(rowOverride, [{ design_status: "finalized" }], baseTime);
    expect(vm1.canOverride).toBe(false);
    expect(vm1.label).toBe("Release Requested (Override)");
    expect(vm1.lockedReason).toContain("manager@ccpatio.com");

    const rowDeposit = {
      status: "AWAITING_DEPOSIT",
      current_step: "awaiting_deposit_or_override",
      release_requested_at: new Date(baseTime.getTime() - 1000),
      release_source: "customer_deposit",
      release_requested_by: "system:deposit",
      created_at: baseTime,
      updated_at: baseTime,
    };
    const vm2 = describePathASaga(rowDeposit, [{ design_status: "finalized" }], baseTime);
    expect(vm2.canOverride).toBe(false);
    expect(vm2.label).toBe("Deposit Recorded (Queued)");
  });

  it("enables retry only for manual failure with recorded release request", () => {
    const failedWithRequest = {
      status: "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
      current_step: "release_failed:sales_order",
      release_requested_at: new Date(baseTime.getTime() - 1000),
      created_at: baseTime,
      updated_at: baseTime,
      last_error: "Katana 500 error",
    };
    const vm = describePathASaga(failedWithRequest, [{ design_status: "finalized" }], baseTime);
    expect(vm.canRetryRelease).toBe(true);
    expect(vm.canOverride).toBe(false);
    expect(vm.label).toBe("Release Failed (Manual)");

    const failedWithoutRequest = {
      status: "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
      current_step: "release_failed:sales_order",
      release_requested_at: null,
      created_at: baseTime,
      updated_at: baseTime,
    };
    const vmNoReq = describePathASaga(failedWithoutRequest, [{ design_status: "finalized" }], baseTime);
    expect(vmNoReq.canRetryRelease).toBe(false);
  });

  it("evaluates override authority by role correctly for UI display", () => {
    const adminSession: PimSession = {
      email: "admin@ccpatio.com",
      name: "Admin User",
      ghl_role: "admin",
    };
    expect(hasOverrideAuthority(adminSession)).toBe(true);

    const viewerSession: PimSession = {
      email: "viewer@ccpatio.com",
      name: "Viewer",
      ghl_role: "user",
    };
    expect(hasOverrideAuthority(viewerSession)).toBe(false);

    const embedSession: PimSession = {
      email: "ghl-embed@ccpatio.com",
      name: "GHL Embed",
      ghl_role: "admin",
    };
    expect(hasOverrideAuthority(embedSession)).toBe(false);

    const nullSession = null;
    expect(hasOverrideAuthority(nullSession)).toBe(false);
  });

  it("handles Postgres 42P01 and 42703 error codes for graceful degradation banner", () => {
    const isMigrationPendingError = (err: any) => {
      const code = err?.code;
      const msg = String(err?.message || "");
      return (
        code === "42P01" ||
        code === "42703" ||
        msg.includes("42P01") ||
        msg.includes("42703") ||
        msg.includes("does not exist") ||
        msg.includes("undefined_table") ||
        msg.includes("undefined_column")
      );
    };

    expect(isMigrationPendingError({ code: "42P01", message: 'relation "custom_build_job_items" does not exist' })).toBe(true);
    expect(isMigrationPendingError({ code: "42703", message: 'column "deposit_cents" of relation "saga_runs" does not exist' })).toBe(true);
    expect(isMigrationPendingError(new Error('relation "custom_build_job_items" does not exist'))).toBe(true);
    expect(isMigrationPendingError({ code: "23505", message: "unique violation" })).toBe(false);
  });

  it("verifies static constraints on UI source files", () => {
    const pageSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/admin/path-a/page.tsx"),
      "utf8",
    );
    const tableSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/admin/path-a/PathAStatusTable.tsx"),
      "utf8",
    );

    // No dlq_events or redrive
    expect(pageSrc).not.toContain("dlq_events");
    expect(pageSrc).not.toContain("redrive");
    expect(tableSrc).not.toContain("dlq_events");
    expect(tableSrc).not.toContain("redrive");

    // No Katana secret or token leaks
    expect(pageSrc).not.toContain("token=");
    expect(pageSrc).not.toContain("cut_card_token");
    expect(tableSrc).not.toContain("token=");
    expect(tableSrc).not.toContain("cut_card_token");

    // Dynamic rendering forced
    expect(pageSrc).toContain('export const dynamic = "force-dynamic"');
  });
});
