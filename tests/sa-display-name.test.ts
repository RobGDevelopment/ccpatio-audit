import { describe, expect, it } from "vitest";
import { humanNameForSaSku } from "@/lib/sa-display-name";

describe("humanNameForSaSku", () => {
  it("names the Bravada club chair frame", () => {
    expect(humanNameForSaSku("SA-BRV-CLB-CHA-34X34-FRAME")).toBe(
      "Bravada Club Chair 34x34 Frame",
    );
  });

  it("names cushions and other collections", () => {
    expect(humanNameForSaSku("SA-BRK-TRA-DOU-CHS-48X72-CUSH")).toBe(
      "Brooklyn Transitional Double Chaise 48x72 Cushion",
    );
    expect(humanNameForSaSku("SA-OCN-SWV-CHA-34X34-FRAME")).toBe(
      "Ocean Swivel Chair 34x34 Frame",
    );
    expect(humanNameForSaSku("SA-OCN-CLB-CHA-34X38-CUSH")).toBe(
      "Ocean Club Chair 34x38 Cushion",
    );
  });

  it("keeps handedness when present", () => {
    expect(humanNameForSaSku("SA-BRO-C-72X34-LS-FRAME")).toBe(
      "Brooklyn Chaise 72x34 Left Side Frame",
    );
  });
});
