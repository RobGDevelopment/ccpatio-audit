/** NMFC freight classes used for LTL rating. */
export const LTL_FREIGHT_CLASSES = [
  "50",
  "55",
  "60",
  "65",
  "70",
  "77.5",
  "85",
  "92.5",
  "100",
  "110",
  "125",
  "150",
  "175",
  "200",
  "250",
  "300",
  "400",
  "500",
] as const;

export type LtlFreightClass = (typeof LTL_FREIGHT_CLASSES)[number];

const LTL_CLASS_SET = new Set<string>(LTL_FREIGHT_CLASSES);

export type LogisticsProfileInput = {
  katanaVariantId: number;
  variantSku: string;
  lengthIn?: string | null;
  widthIn?: string | null;
  heightIn?: string | null;
  weightLb?: string | null;
  ltlClass?: string | null;
  asset3dUrl?: string | null;
  isModularComponent?: boolean;
};

export type NormalizedLogisticsProfile = {
  katanaVariantId: number;
  variantSku: string;
  lengthIn: string | null;
  widthIn: string | null;
  heightIn: string | null;
  weightLb: string | null;
  ltlClass: LtlFreightClass | null;
  asset3dUrl: string | null;
  isModularComponent: boolean;
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function parseMeasure(raw: string | null | undefined, label: string): string | null {
  if (raw == null || raw.trim() === "") return null;
  const cleaned = raw.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,4})?$/.test(cleaned)) {
    throw new Error(`${label} must be a positive number with up to 4 decimal places`);
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0 || value > 100_000) {
    throw new Error(`${label} must be greater than 0 and at most 100000`);
  }
  return cleaned;
}

function parseAssetUrl(raw: string | null | undefined): string | null {
  if (raw == null || raw.trim() === "") return null;
  const value = raw.trim();
  if (value.length > 2000) {
    throw new Error("3D asset URL is too long");
  }
  let pathname = value;
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("3D asset URL must be a valid http(s) URL");
    }
    pathname = url.pathname;
  } else if (!value.startsWith("/")) {
    throw new Error("3D asset URL must be an http(s) URL or a site path");
  }
  if (!/\.(glb|gltf)$/i.test(pathname)) {
    throw new Error("3D asset URL must point to a .glb or .gltf file");
  }
  return value;
}

export function normalizeLogisticsProfile(
  input: LogisticsProfileInput,
): NormalizedLogisticsProfile {
  const variantSku = normalizeSku(input.variantSku ?? "");
  if (!variantSku) {
    throw new Error("Variant SKU is required");
  }
  if (variantSku.length > 128) {
    throw new Error("Variant SKU must be 128 characters or fewer");
  }
  const katanaVariantId = Number(input.katanaVariantId);
  if (!Number.isInteger(katanaVariantId) || katanaVariantId <= 0) {
    throw new Error("Katana variant ID must be a positive integer");
  }

  const ltlRaw = input.ltlClass?.trim() ?? "";
  if (ltlRaw && !LTL_CLASS_SET.has(ltlRaw)) {
    throw new Error("LTL class must be a standard NMFC freight class");
  }

  return {
    katanaVariantId,
    variantSku,
    lengthIn: parseMeasure(input.lengthIn, "Length"),
    widthIn: parseMeasure(input.widthIn, "Width"),
    heightIn: parseMeasure(input.heightIn, "Height"),
    weightLb: parseMeasure(input.weightLb, "Weight"),
    ltlClass: ltlRaw ? (ltlRaw as LtlFreightClass) : null,
    asset3dUrl: parseAssetUrl(input.asset3dUrl),
    isModularComponent: Boolean(input.isModularComponent),
  };
}
