/**
 * Human-readable Katana product names from SA-/ASM- FRAME/CUSH SKUs.
 * Example: SA-BRV-CLB-CHA-34X34-FRAME → "Bravada Club Chair 34x34 Frame"
 */

const COLLECTION_LABEL: Readonly<Record<string, string>> = {
  BRV: "Bravada",
  BRA: "Bravada",
  BRK: "Brooklyn",
  BRO: "Brooklyn",
  OCN: "Ocean",
  OCE: "Ocean",
  MLN: "Milan",
  WFT: "Waterfall",
  DAI: "Daisy",
  ESY: "Flexy",
  TJM: "Tenjam",
  CAB: "Cabana",
};

/** Longest-first Hub category codes. */
const CATEGORY_LABEL: ReadonlyArray<[string, string]> = [
  ["TRA-DOU-CHS", "Transitional Double Chaise"],
  ["TRA-SGL-CHS", "Transitional Single Chaise"],
  ["ARM-SOF", "Armless Sofa"],
  ["ARM-LOV", "Armless Loveseat"],
  ["COR-SOF", "Corner Sofa"],
  ["COR-CHS", "Corner Chaise"],
  ["MIN-LOV", "Mini Loveseat"],
  ["LOV-SOF", "Loveseat"],
  ["CLB-CHA", "Club Chair"],
  ["SWV-CHA", "Swivel Chair"],
  ["DOU-CHS", "Double Chaise"],
  ["SGL-CHS", "Single Chaise"],
  ["COF-TAB", "Coffee Table"],
  ["SID-TAB", "Side Table"],
  ["DIN-TAB", "Dining Table"],
  ["BAR-TAB", "Bar Table"],
  ["CNT-TAB", "Counter Table"],
  ["OTT-DKT", "Dekton Ottoman"],
  ["CHS", "Chaise"],
  ["SOF", "Sofa"],
  ["OTT", "Ottoman"],
  ["DYB", "Daybed"],
  ["CHA", "Chair"],
  ["TAB", "Table"],
  ["CC", "Club Chair"],
  ["C", "Chaise"],
  ["S", "Sofa"],
  ["L", "Loveseat"],
];

const HAND_LABEL: Readonly<Record<string, string>> = {
  LS: "Left Side",
  RS: "Right Side",
  LAF: "Left Arm Facing",
  RAF: "Right Arm Facing",
};

const WXD = /^(\d{2,3})X(\d{2,3})$/;
const ONE_DIM = /^(\d{2,3})$/;

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function titleCaseToken(token: string): string {
  const lower = token.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function categoryLabel(joined: string): string {
  const n = joined.toUpperCase();
  for (const [code, label] of CATEGORY_LABEL) {
    if (n === code) return label;
  }
  return n
    .split("-")
    .filter(Boolean)
    .map(titleCaseToken)
    .join(" ");
}

export function humanNameForSaSku(skuRaw: string): string {
  const sku = normalizeSku(skuRaw);
  const parts = sku.split("-").filter(Boolean);
  if (parts[0] === "SA" || parts[0] === "ASM") parts.shift();
  if (parts.length === 0) return sku;

  let role = "";
  const last = parts[parts.length - 1]!;
  if (last === "FRAME") {
    role = "Frame";
    parts.pop();
  } else if (last === "CUSH" || last === "CUSHION") {
    role = "Cushion";
    parts.pop();
  } else if (last === "BASE") {
    role = "Base";
    parts.pop();
  }

  let hand = "";
  const maybeHand = parts[parts.length - 1];
  if (maybeHand && HAND_LABEL[maybeHand]) {
    hand = HAND_LABEL[maybeHand]!;
    parts.pop();
  }

  let dim = "";
  const maybeDim = parts[parts.length - 1];
  if (maybeDim) {
    const wxd = WXD.exec(maybeDim);
    if (wxd) {
      dim = `${Number(wxd[1])}x${Number(wxd[2])}`;
      parts.pop();
    } else if (ONE_DIM.test(maybeDim) && Number(maybeDim) >= 16) {
      dim = String(Number(maybeDim));
      parts.pop();
    }
  }

  const collectionCode = parts.shift() ?? "";
  const collection = COLLECTION_LABEL[collectionCode] ?? titleCaseToken(collectionCode);
  const category = categoryLabel(parts.join("-"));

  return [collection, category, dim, hand, role].filter(Boolean).join(" ");
}
