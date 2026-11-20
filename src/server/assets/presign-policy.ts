/**
 * Pure validators for Asset Studio presigned uploads (no IO, no env).
 * Only server-built keys are ever signed; commit re-validates that the client-supplied
 * bucket/path is exactly one this policy could have produced.
 */

export const ASSET_KINDS = ["finish_swatch", "product_3d"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const FINISH_SLOTS = ["thumb", "texture_2k", "normal_map", "roughness_map"] as const;
export const PRODUCT_3D_SLOTS = ["glb", "usdz", "poster"] as const;
export const ASSET_SLOTS = [...FINISH_SLOTS, ...PRODUCT_3D_SLOTS] as const;
export type FinishSlot = (typeof FINISH_SLOTS)[number];
export type Product3dSlot = (typeof PRODUCT_3D_SLOTS)[number];
export type AssetSlot = (typeof ASSET_SLOTS)[number];

export const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const MODEL_MAX_BYTES = 100 * 1024 * 1024;

export const FINISH_BUCKET = "product-images";
export const PRODUCT_3D_BUCKET = "cad-models";

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"] as const;

const IMAGE_MIME: Record<string, readonly string[]> = {
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
};

const MODEL_EXTS: Record<"glb" | "usdz", readonly string[]> = {
  glb: ["glb", "gltf"],
  usdz: ["usdz"],
};

const MODEL_MIME: Record<string, { canonical: string; accepts: readonly string[] }> = {
  glb: { canonical: "model/gltf-binary", accepts: ["model/gltf-binary", "application/octet-stream"] },
  gltf: { canonical: "model/gltf+json", accepts: ["model/gltf+json", "application/octet-stream"] },
  usdz: { canonical: "model/vnd.usdz+zip", accepts: ["model/vnd.usdz+zip", "application/octet-stream"] },
};

/** Executable / scriptable / markup extensions - rejected anywhere in a dotted filename. */
const DENIED_EXTS = new Set([
  "svg", "svgz", "html", "htm", "xhtml", "xml", "js", "mjs", "cjs", "jsx", "ts", "tsx",
  "php", "phtml", "phar", "exe", "dll", "bat", "cmd", "com", "msi", "sh", "ps1", "jar",
  "py", "rb", "pl", "asp", "aspx", "jsp", "cgi", "swf",
]);

const SKU_SEGMENT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type PresignInput = {
  kind: unknown;
  sku?: unknown;
  woo_sku?: unknown;
  slot: unknown;
  filename: unknown;
  contentType?: unknown;
  byteSize: unknown;
};

export type PresignPlan = {
  ok: true;
  kind: AssetKind;
  slot: AssetSlot;
  bucket: string;
  path: string;
  ext: string;
  contentType: string;
  byteSize: number;
  /** Lower-cased SKU segment used in the object key (global_sku / woo_sku / finish sku). */
  subject: string;
};

export type PolicyFailure = { ok: false; status: 400; reason: string };
export type PresignResult = PresignPlan | PolicyFailure;

const fail = (reason: string): PolicyFailure => ({ ok: false, status: 400, reason });

export function isAssetKind(v: unknown): v is AssetKind {
  return typeof v === "string" && (ASSET_KINDS as readonly string[]).includes(v);
}

export function isAssetSlot(v: unknown): v is AssetSlot {
  return typeof v === "string" && (ASSET_SLOTS as readonly string[]).includes(v);
}

export function slotBelongsToKind(kind: AssetKind, slot: AssetSlot): boolean {
  return kind === "finish_swatch"
    ? (FINISH_SLOTS as readonly string[]).includes(slot)
    : (PRODUCT_3D_SLOTS as readonly string[]).includes(slot);
}

export function bucketForKind(kind: AssetKind): string {
  return kind === "finish_swatch" ? FINISH_BUCKET : PRODUCT_3D_BUCKET;
}

/** 3D model slots allow 100 MB; every image slot (incl. the 3D poster) allows 25 MB. */
export function maxBytesForSlot(slot: AssetSlot): number {
  return slot === "glb" || slot === "usdz" ? MODEL_MAX_BYTES : IMAGE_MAX_BYTES;
}

/** Normalizes + validates a SKU path segment (no separators, no `..`). Returns null if unsafe. */
export function normalizeSkuSegment(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s || s.includes("..") || !SKU_SEGMENT_RE.test(s)) return null;
  return s;
}

/** Validates a client filename and returns its lower-cased extension, or a failure. */
export function validateFilename(filename: unknown): { ok: true; ext: string } | PolicyFailure {
  if (typeof filename !== "string" || !filename.trim()) return fail("filename is required");
  const name = filename.trim();
  if (name.length > 200) return fail("filename too long");
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return fail("filename must not contain path separators or '..'");
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) return fail("filename contains control characters");
  const parts = name.toLowerCase().split(".");
  if (parts.length < 2) return fail("filename must have an extension");
  // Check every dotted segment so `shell.php.jpg` is rejected too.
  for (const seg of parts.slice(1)) {
    if (DENIED_EXTS.has(seg)) return fail(`file type .${seg} is not allowed`);
  }
  return { ok: true, ext: parts[parts.length - 1]! };
}

function resolveContentType(slot: AssetSlot, ext: string, provided: unknown): string | PolicyFailure {
  const given = typeof provided === "string" ? provided.trim().toLowerCase().split(";")[0]!.trim() : "";
  if (slot === "glb" || slot === "usdz") {
    const spec = MODEL_MIME[ext]!;
    if (given && !spec.accepts.includes(given)) {
      return fail(`contentType ${given} does not match .${ext}`);
    }
    return spec.canonical;
  }
  const accepted = IMAGE_MIME[ext]!;
  if (given && !accepted.includes(given)) {
    return fail(`contentType ${given} does not match .${ext}`);
  }
  return accepted[0]!;
}

function randomSuffix(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validates a presign request and computes the server-owned bucket/object key.
 * `opts.rand` is injectable for deterministic tests.
 */
export function planPresignedUpload(
  input: PresignInput,
  opts: { rand?: string } = {},
): PresignResult {
  if (!isAssetKind(input.kind)) return fail("kind must be finish_swatch or product_3d");
  if (!isAssetSlot(input.slot)) return fail(`slot must be one of ${ASSET_SLOTS.join(", ")}`);
  const kind = input.kind;
  const slot = input.slot;
  if (!slotBelongsToKind(kind, slot)) return fail(`slot ${slot} is not valid for kind ${kind}`);

  const rawSubject =
    kind === "finish_swatch" ? input.sku : (input.woo_sku ?? input.sku);
  const subject = normalizeSkuSegment(rawSubject);
  if (!subject) {
    return fail(kind === "finish_swatch" ? "a valid sku is required" : "a valid woo_sku or sku is required");
  }

  const name = validateFilename(input.filename);
  if (!name.ok) return name;
  const ext = name.ext;

  const allowedExts: readonly string[] =
    slot === "glb" ? MODEL_EXTS.glb : slot === "usdz" ? MODEL_EXTS.usdz : IMAGE_EXTS;
  if (!allowedExts.includes(ext)) {
    return fail(`slot ${slot} accepts only: ${allowedExts.map((e) => `.${e}`).join(", ")}`);
  }

  const byteSize = typeof input.byteSize === "number" ? input.byteSize : Number(input.byteSize);
  if (!Number.isFinite(byteSize) || !Number.isInteger(byteSize) || byteSize <= 0) {
    return fail("byteSize must be a positive integer");
  }
  const max = maxBytesForSlot(slot);
  if (byteSize > max) {
    return fail(`file too large: ${byteSize} bytes exceeds ${Math.round(max / (1024 * 1024))} MB for slot ${slot}`);
  }

  const contentType = resolveContentType(slot, ext, input.contentType);
  if (typeof contentType !== "string") return contentType;

  const rand = opts.rand ?? randomSuffix();
  const prefix = kind === "finish_swatch" ? `finishes/${subject}` : `products/${subject}`;
  return {
    ok: true,
    kind,
    slot,
    bucket: bucketForKind(kind),
    path: `${prefix}/${slot}-${rand}.${ext}`,
    ext,
    contentType,
    byteSize,
    subject,
  };
}

/**
 * Commit-time guard: the client-supplied bucket/path must be exactly a key shape that
 * `planPresignedUpload` issues for this (kind, subject, slot). Prevents pointing a DB row at
 * an arbitrary object.
 */
export function validateCommitTarget(input: {
  kind: unknown;
  sku?: unknown;
  woo_sku?: unknown;
  slot: unknown;
  bucket: unknown;
  path: unknown;
}):
  | { ok: true; kind: AssetKind; slot: AssetSlot; bucket: string; path: string; subject: string; ext: string }
  | PolicyFailure {
  if (!isAssetKind(input.kind)) return fail("kind must be finish_swatch or product_3d");
  if (!isAssetSlot(input.slot)) return fail(`slot must be one of ${ASSET_SLOTS.join(", ")}`);
  const { kind, slot } = input;
  if (!slotBelongsToKind(kind, slot)) return fail(`slot ${slot} is not valid for kind ${kind}`);
  const subject = normalizeSkuSegment(kind === "finish_swatch" ? input.sku : (input.woo_sku ?? input.sku));
  if (!subject) return fail("a valid sku is required");
  const bucket = bucketForKind(kind);
  if (input.bucket !== bucket) return fail(`bucket must be ${bucket} for kind ${kind}`);
  if (typeof input.path !== "string") return fail("path is required");
  const path = input.path;
  if (path.includes("..") || path.includes("\\")) return fail("invalid path");
  const prefix = kind === "finish_swatch" ? `finishes/${subject}` : `products/${subject}`;
  const re = new RegExp(
    `^${prefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/${slot}-[a-f0-9]{6,32}\\.([a-z0-9]{2,5})$`,
  );
  const m = re.exec(path);
  if (!m) return fail("path does not match a server-issued upload key for this sku/slot");
  const ext = m[1]!;
  const allowedExts: readonly string[] =
    slot === "glb" ? MODEL_EXTS.glb : slot === "usdz" ? MODEL_EXTS.usdz : IMAGE_EXTS;
  if (!allowedExts.includes(ext)) return fail(`extension .${ext} is not valid for slot ${slot}`);
  return { ok: true, kind, slot, bucket, path, subject, ext };
}
