import crypto from "crypto";

export class CadConvertError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "CadConvertError";
  }
}

export async function convertBlendToGlb(blendFile: Buffer, filename: string): Promise<{ glb: Buffer; sha256: string }> {
  const url = process.env.CAD_CONVERT_URL || "http://localhost:8000/convert";
  
  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(blendFile)]), filename);

  const controller = new AbortController();
  // Blender exports can be slow
  const timeout = setTimeout(() => controller.abort(), 120000); 

  try {
    const res = await fetch(url, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 415) {
         throw new CadConvertError("SKP_CONVERT_UNAVAILABLE", 415);
      }
      throw new CadConvertError(`Conversion failed: ${res.statusText}`, res.status);
    }

    const arrayBuffer = await res.arrayBuffer();
    const glb = Buffer.from(arrayBuffer);
    const hash = crypto.createHash("sha256").update(glb).digest("hex");

    return { glb, sha256: hash };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new CadConvertError("Conversion timeout", 408);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
