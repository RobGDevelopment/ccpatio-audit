/**
 * Pure validators for Tab 1 Intake signed uploads (renders / mp4 / glb / pdf / swatches).
 */
export const INTAKE_KINDS = [
  "finish_swatch",
  "product_render",
  "product_video",
  "product_3d",
  "product_pdf",
] as const;
export type IntakeKind = (typeof INTAKE_KINDS)[number];

export const INTAKE_IMAGE_MAX = 40 * 1024 * 1024;
export const INTAKE_VIDEO_MAX = 200 * 1024 * 1024;
export const INTAKE_MODEL_MAX = 100 * 1024 * 1024;
export const INTAKE_PDF_MAX = 40 * 1024 * 1024;

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp"]);
const VIDEO_EXTS = new Set(["mp4", "webm"]);
const MODEL_EXTS = new Set(["glb", "usdz"]);
const PDF_EXTS = new Set(["pdf"]);

const DENIED = new Set([
  "svg", "html", "htm", "js", "mjs", "exe", "bat", "cmd", "php", "sh", "ps1",
]);

export type IntakePlan =
  | {
      ok: true;
      kind: IntakeKind;
      bucket: string;
      path: string;
      contentType: string;
      byteSize: number;
      ext: string;
    }
  | { ok: false; status: 400; reason: string };

function extOf(filename: string): string {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? (parts.pop() ?? "") : "";
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function planIntakeUpload(input: {
  kind: unknown;
  filename: unknown;
  contentType?: unknown;
  byteSize: unknown;
  sku?: unknown;
  woo_sku?: unknown;
}): IntakePlan {
  if (typeof input.kind !== "string" || !(INTAKE_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, status: 400, reason: "Invalid intake kind" };
  }
  const kind = input.kind as IntakeKind;
  if (typeof input.filename !== "string" || !input.filename.trim()) {
    return { ok: false, status: 400, reason: "filename required" };
  }
  if (typeof input.byteSize !== "number" || !Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, status: 400, reason: "byteSize required" };
  }
  const filename = input.filename.trim();
  const ext = extOf(filename);
  if (!ext || DENIED.has(ext) || filename.toLowerCase().split(".").some((p) => DENIED.has(p))) {
    return { ok: false, status: 400, reason: `Extension .${ext || "?"} not allowed` };
  }

  const subject = String(input.woo_sku ?? input.sku ?? "intake")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "-")
    .slice(0, 64) || "intake";

  let bucket = "product-images";
  let max = INTAKE_IMAGE_MAX;
  let contentType = typeof input.contentType === "string" ? input.contentType : "application/octet-stream";
  let pathPrefix = `intake/${kind}`;

  if (kind === "finish_swatch" || kind === "product_render") {
    if (!IMAGE_EXTS.has(ext)) {
      return { ok: false, status: 400, reason: "Expected image .jpg/.png/.webp" };
    }
    max = INTAKE_IMAGE_MAX;
    contentType =
      ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    pathPrefix = kind === "finish_swatch" ? `intake/finish/${subject}` : `intake/renders/${subject}`;
  } else if (kind === "product_video") {
    if (!VIDEO_EXTS.has(ext)) {
      return { ok: false, status: 400, reason: "Expected video .mp4/.webm" };
    }
    max = INTAKE_VIDEO_MAX;
    contentType = ext === "webm" ? "video/webm" : "video/mp4";
    pathPrefix = `intake/video/${subject}`;
  } else if (kind === "product_3d") {
    if (!MODEL_EXTS.has(ext)) {
      return { ok: false, status: 400, reason: "Expected 3D .glb/.usdz" };
    }
    bucket = "cad-models";
    max = INTAKE_MODEL_MAX;
    contentType = ext === "usdz" ? "model/vnd.usdz+zip" : "model/gltf-binary";
    pathPrefix = `intake/3d/${subject}`;
  } else if (kind === "product_pdf") {
    if (!PDF_EXTS.has(ext)) {
      return { ok: false, status: 400, reason: "Expected .pdf" };
    }
    bucket = "product-documents";
    max = INTAKE_PDF_MAX;
    contentType = "application/pdf";
    pathPrefix = `intake/pdf/${subject}`;
  }

  if (input.byteSize > max) {
    return { ok: false, status: 400, reason: `File exceeds ${Math.round(max / (1024 * 1024))}MB limit` };
  }

  const path = `${pathPrefix}/${Date.now()}-${randomSuffix()}.${ext}`;
  return {
    ok: true,
    kind,
    bucket,
    path,
    contentType,
    byteSize: input.byteSize,
    ext,
  };
}
