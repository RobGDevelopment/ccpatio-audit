import { describe, expect, it } from "vitest";
import {
  classifyDropped,
  PACKET_MAX_BYTES,
  CAD_MAX_BYTES,
} from "@/lib/intake/files";

describe("Intake File Classification (classifyDropped)", () => {
  it("enforces maximum size constants equal to 25 MiB", () => {
    expect(PACKET_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(CAD_MAX_BYTES).toBe(25 * 1024 * 1024);
  });

  it("classifies dropped .glb and .pdf", () => {
    const files = [
      { name: "sofa.glb", size: 1024 * 100, type: "model/gltf-binary" },
      { name: "order.pdf", size: 1024 * 50, type: "application/pdf" },
      { name: "render.png", size: 1024 * 20, type: "image/png" },
    ];

    const result = classifyDropped(files as File[]);
    expect(result.geometry?.name).toBe("sofa.glb");
    expect(result.packet?.name).toBe("order.pdf");
    expect(result.images).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("rejects standalone .skp as geometry without companion format", () => {
    const files = [{ name: "model.skp", size: 1024 * 100, type: "" }];
    const result = classifyDropped(files as File[]);

    expect(result.geometry).toBeUndefined();
    expect(result.rejected).toContainEqual(
      expect.objectContaining({
        filename: "model.skp",
        reason: "SKP_ONLY",
      })
    );
  });

  it("rejects more than one geometry file", () => {
    const files = [
      { name: "chair.glb", size: 1000, type: "" },
      { name: "table.blend", size: 1000, type: "" },
    ];
    const result = classifyDropped(files as File[]);
    expect(result.rejected).toContainEqual(
      expect.objectContaining({
        reason: "MULTIPLE_GEOMETRY",
      })
    );
  });

  it("rejects files over 25 MB", () => {
    const files = [
      { name: "giant.glb", size: 30 * 1024 * 1024, type: "" },
    ];
    const result = classifyDropped(files as File[]);
    expect(result.rejected).toContainEqual(
      expect.objectContaining({
        filename: "giant.glb",
        reason: "FILE_TOO_LARGE",
      })
    );
  });

  it("rejects unsupported file extensions (e.g. .exe, .zip)", () => {
    const files = [
      { name: "bad.exe", size: 100, type: "" },
    ];
    const result = classifyDropped(files as File[]);
    expect(result.rejected).toContainEqual(
      expect.objectContaining({
        filename: "bad.exe",
        reason: "FILE_TYPE",
      })
    );
  });
});
