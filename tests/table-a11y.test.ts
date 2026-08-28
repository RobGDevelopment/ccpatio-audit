import { describe, expect, it, vi } from "vitest";
import { handleInteractiveRowKeyDown } from "@/app/admin/shared/table-a11y";

describe("table-a11y", () => {
  it("activates row on Enter and Space", () => {
    const onActivate = vi.fn();
    handleInteractiveRowKeyDown(
      { key: "Enter", preventDefault: vi.fn() } as unknown as React.KeyboardEvent,
      onActivate,
    );
    expect(onActivate).toHaveBeenCalledOnce();

    onActivate.mockClear();
    handleInteractiveRowKeyDown(
      { key: " ", preventDefault: vi.fn() } as unknown as React.KeyboardEvent,
      onActivate,
    );
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("ignores unrelated keys", () => {
    const onActivate = vi.fn();
    handleInteractiveRowKeyDown(
      { key: "Tab", preventDefault: vi.fn() } as unknown as React.KeyboardEvent,
      onActivate,
    );
    expect(onActivate).not.toHaveBeenCalled();
  });
});
