import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cadIngestExtension } from "@/app/admin/factory-bom/actions";
import { extractSkpThumbnail } from "@/lib/cad-upload/skp-thumbnail";
import {
  classifyExtrusion,
  parseDaeWeldmentFromXml,
} from "@/lib/sketchup-cutlist";

const SAMPLE_DAE = path.resolve(
  process.cwd(),
  "docs/BOM_Examples/SketchupFiles/FIN-WFT-DIN-TAB-72X28.dae",
);

/** PNG with a long tEXt chunk so extractSkpThumbnail length gate (>200) passes. */
function craftedSkpWithPng(): Buffer {
  const sigAndIhdr = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
    "hex",
  );
  const textData = Buffer.alloc(240, 0x41);
  const textChunk = Buffer.alloc(12 + textData.length);
  textChunk.writeUInt32BE(textData.length, 0);
  textChunk.write("tEXt", 4);
  textData.copy(textChunk, 8);
  textChunk.writeUInt32BE(0, 8 + textData.length);
  const iend = Buffer.from("0000000049454e44ae426082", "hex");
  return Buffer.concat([
    Buffer.from("SKP-PREFIX"),
    sigAndIhdr,
    textChunk,
    iend,
    Buffer.from("SKP-SUFFIX"),
  ]);
}

describe("CAD upload pipeline foundations", () => {
  it("classifyExtrusion still maps AABB boxes to tube profiles", () => {
    const c = classifyExtrusion([2, 2, 72]);
    expect(c?.profile).toBe("2x2");
    expect(c?.length).toBe(72);
    expect(c?.profileCode).toBeTruthy();
  });

  it("parseDaeWeldmentFromXml accepts Buffer (Storage download path)", () => {
    expect(fs.existsSync(SAMPLE_DAE)).toBe(true);
    const buf = fs.readFileSync(SAMPLE_DAE);
    const result = parseDaeWeldmentFromXml(buf, "FIN-WFT-DIN-TAB-72X28.dae");
    expect(result.walker.sticks.length).toBeGreaterThan(0);
    expect(result.rollup.length).toBeGreaterThan(0);
  });

  it("extractSkpThumbnail finds embedded PNG signature -> IEND", () => {
    const extracted = extractSkpThumbnail(craftedSkpWithPng());
    expect(extracted).not.toBeNull();
    expect(extracted![0]).toBe(0x89);
    expect(extracted![1]).toBe(0x50);
    expect(extracted!.length).toBeGreaterThan(200);
  });
});

describe("CAD ingest gateway", () => {
  it("accepts dae, glb, blend, and skp and rejects every other extension", async () => {
    expect(await cadIngestExtension("FIN-WFT-DIN-TAB-72X28.dae")).toBe("dae");
    expect(await cadIngestExtension("model.GLB")).toBe("glb");
    expect(await cadIngestExtension("chair.blend")).toBe("blend");
    expect(await cadIngestExtension("preview.skp")).toBe("skp");
    expect(await cadIngestExtension("chair.obj")).toBeNull();
    expect(await cadIngestExtension("notes.pdf")).toBeNull();
    expect(await cadIngestExtension("no-extension")).toBeNull();
  });

  it("dropzones and the commerce vault advertise the same geometry extensions", () => {
    const admin = fs.readFileSync(
      path.join(process.cwd(), "src/app/admin/factory-bom/CadUploadDropzone.tsx"),
      "utf8",
    );
    const dropStepPath = path.join(process.cwd(), "src/app/embed/factory-bom/intake/DropStep.tsx");
    const intake = fs.existsSync(dropStepPath)
      ? fs.readFileSync(dropStepPath, "utf8")
      : "";
    const vault = fs.readFileSync(
      path.join(process.cwd(), "src/app/embed/admin/master-catalog/ecommerce/AssetVaultDropzone.tsx"),
      "utf8",
    );
    const env = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    const picker = 'accept=".dae,.glb,.skp,.blend,image/png,image/jpeg,image/webp"';
    expect(admin).toContain(picker);
    if (intake) {
      expect(intake).toContain(".glb");
      expect(intake).toContain(".blend");
    }
    expect(vault).toContain('accept=".dae,.glb,.skp,.blend"');
    expect(env).toMatch(/^CAD_CONVERT_URL=$/m);
  });
});

describe("Inngest processCadUpload mapping", () => {
  it("preserves glb, dae, skp, blend and rejects invalid extensions", async () => {
    const { processCadUpload } = await import("@/inngest/functions");
    const { NonRetriableError } = await import("inngest");

    // The Inngest function handler is exposed on .fn
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (processCadUpload as any).fn;
    
    // Valid ones (mocking step.run to throw a dummy error just to stop execution)
    const stepMock = {
      run: async (name: string, cb: any) => { throw new Error("STOP_EXECUTION"); }
    };

    const validExts = ["glb", "dae", "skp", "blend"];
    for (const ext of validExts) {
      const event = {
        data: { uploadId: "123", globalSku: "SKU", storagePath: "path", ext }
      };
      await expect(handler({ event, step: stepMock })).rejects.toThrow("STOP_EXECUTION");
    }

    // Invalid ones
    const invalidExts = ["png", "pdf", "txt", ""];
    for (const ext of invalidExts) {
      const event = {
        data: { uploadId: "123", globalSku: "SKU", storagePath: "path", ext }
      };
      await expect(handler({ event, step: stepMock })).rejects.toThrow(NonRetriableError);
    }
  });
});
