/**
 * Mia Aluminum PDF ground-truth pricing helpers (pure — no I/O).
 * Authoritative website Regular price = Mia's ALUMINUM column (Oct 1 base +
 * manual $0/$5 rounding). Formula ×1.10 is fallback only for missing rows /
 * New Product wizard.
 */

export const MIA_PDF_FIXTURE_REL =
  "data_migration/Pricing/mia-aluminum-pricelist-2026-11-19.json" as const;

export const PRICE_REVIEW_MISSING = "missing_from_mia_pdf" as const;
export const PRICE_REVIEW_ODD = "odd_dollar_in_pdf" as const;

export type PriceReviewFlag =
  | typeof PRICE_REVIEW_MISSING
  | typeof PRICE_REVIEW_ODD
  | null;

export const STOREFRONT_POLICY_BANNER_MIA =
  "Storefront Policy: Aluminum Only — Website Price from Mia PDF • Disregard Steel MSRP";

/** Mia nearest-$5 Aluminum rule: round((base * 1.10) / 5) * 5 */
export function roundNearest5Alu(baseCostOrMsrp: number): number {
  if (!Number.isFinite(baseCostOrMsrp) || baseCostOrMsrp < 0) {
    throw new Error(`Invalid base for nearest-$5: ${baseCostOrMsrp}`);
  }
  return Math.round((baseCostOrMsrp * 1.1) / 5) * 5;
}

/** True when price does not end in $0 or $5 (whole dollars) or .99 resale cents. */
export function isOddDollarPrice(price: number): boolean {
  if (!Number.isFinite(price)) return false;
  const cents = Math.round(price * 100);
  // Resale .99 endings are intentional — not "odd dollar" review flags.
  if (cents % 100 === 99) return false;
  const dollars = Math.round(price);
  if (Math.abs(price - dollars) > 0.001) {
    // Non-integer non-.99 → odd
    return true;
  }
  const lastDigit = Math.abs(dollars) % 10;
  return lastDigit !== 0 && lastDigit !== 5;
}

export function suggestedNearest5(price: number): number {
  return Math.round(price / 5) * 5;
}

export type MiaPdfRow = {
  page: number;
  collection: string;
  description: string;
  oct1_msrp: number | null;
  mia_aluminum_price: number;
  category: "metal" | "non_metal" | "accessory";
  price_review_flag: PriceReviewFlag;
  matched_skus: string[];
  source: "pdf" | "synthetic";
};

export type MiaPdfFixture = {
  source_pdf: string;
  extracted_at: string;
  parser_version: number;
  page_count: number;
  row_count: number;
  metal_row_count: number;
  non_metal_row_count: number;
  rows: MiaPdfRow[];
  sku_price_index: Record<
    string,
    {
      price: number;
      flag: PriceReviewFlag;
      source: "pdf" | "synthetic";
      pdf_description?: string;
      oct1_msrp?: number | null;
    }
  >;
  phase1_spot_check_skus: string[];
};

/** Explicit SOW → PDF description aliases (must match 100%). */
export const SOW_TO_PDF_ALIAS: ReadonlyArray<{
  sku: string;
  sowNameIncludes?: string;
  sowNameExcludes?: string;
  pdfDescription: string;
  price: number;
}> = [
  {
    sku: "FIN-BRV-DYB-72X72",
    pdfDescription: 'BRAVADA DAYBED 72" x 78" x 27" BH',
    price: 7480,
  },
  {
    sku: "FIN-BRV-DYB-84X72",
    pdfDescription: 'BRAVADA DAYBED 78" x 78" x 27" BH',
    price: 7755,
  },
  {
    sku: "FIN-BRV-DYB-84X84",
    sowNameExcludes: "ROUND",
    pdfDescription: 'BRAVADA DAYBED 84" x 78" x 27" BH',
    price: 8140,
  },
  {
    sku: "FIN-BRV-DYB-84X84",
    sowNameIncludes: "ROUND",
    pdfDescription: 'BRAVADA ROUND DAYBED 84" DIAMETER',
    price: 8415,
  },
  {
    sku: "FIN-BRV-SWG-72X12",
    pdfDescription: '60" ROUND SWING 60" x 12" SH',
    price: 3600,
  },
  {
    sku: "FIN-BRV-SWG-96X32",
    pdfDescription: 'BRAVADA SWING 96" x 42" x 23" BH',
    price: 6235,
  },
  {
    sku: "FIN-OCN-TAB-34X12",
    pdfDescription: 'FLY TABLE 34" X 12"',
    price: 550,
  },
  {
    sku: "FIN-OCN-TAB-13X30",
    pdfDescription: 'T TABLE 13" x 30" x 16"',
    price: 550,
  },
];

/** Phase 1 Milan ottomans absent from Mia's PDF — nearest-$5 from SOW MSRP. */
export const MISSING_MILAN_OTTOMANS: ReadonlyArray<{
  sku: string;
  sowMsrp: number;
  aluminum: number;
  name: string;
}> = [
  {
    sku: "FIN-MLN-OTT-22X60",
    sowMsrp: 1280,
    aluminum: 1410,
    name: 'MILAN OTTOMAN 22" x 60" x 16"',
  },
  {
    sku: "FIN-MLN-OTT-22X72",
    sowMsrp: 1500,
    aluminum: 1650,
    name: 'MILAN OTTOMAN 22" x 72" x 16"',
  },
  {
    sku: "FIN-MLN-OTT-34X60",
    sowMsrp: 1850,
    aluminum: 2035,
    name: 'MILAN OTTOMAN 34" x 60" x 16"',
  },
  {
    sku: "FIN-MLN-OTT-56X42",
    sowMsrp: 2040,
    aluminum: 2245,
    name: 'MILAN OTTOMAN 56" x 42" x 16"',
  },
];

/** Known odd-dollar PDF rows (preserve exact; flag for Mia). */
export const ODD_DOLLAR_PDF_ROWS: ReadonlyArray<{
  pdfDescription: string;
  price: number;
  suggested: number;
  phase: 1 | 2;
  skuHint?: string;
}> = [
  {
    pdfDescription: 'STAR LEG TABLE (DINING HEIGHT) 36" x 36" x 30"',
    price: 3328,
    suggested: 3325,
    phase: 1,
    skuHint: "FIN-BRK-DIN-TAB-36X36",
  },
  {
    pdfDescription: 'DINING BENCH w/NO ARMS 96" x 22" x 18" SH',
    price: 2772,
    suggested: 2770,
    phase: 1,
    skuHint: "FIN-WFT-DIN-BCH-96X22",
  },
  {
    pdfDescription: 'FLY LEG BARSTOOL (COUNTER HEIGHT) 18" x 18" x 24" SH',
    price: 902,
    suggested: 900,
    phase: 1,
    skuHint: "FIN-WFT-FLY-BST-18X18",
  },
  {
    pdfDescription: 'DAISY BASE TABLE (DINING HEIGHT) 42" x 120" x 30"',
    price: 7579,
    suggested: 7570,
    phase: 2,
  },
  {
    pdfDescription: 'BROOKLYN TABLE (DINING HEIGHT) 28" x 120" x 30"',
    price: 4714,
    suggested: 4715,
    phase: 2,
  },
  {
    pdfDescription: 'BROOKLYN OTTOMAN 34" x 34" x 17"',
    price: 1364,
    suggested: 1365,
    phase: 2,
  },
];

/** Explicit non-metal / resale price overrides from Mia PDF. */
export const NON_METAL_PDF_PRICES: ReadonlyArray<{
  match: RegExp;
  price: number;
  sku?: string;
}> = [
  { match: /CANTILEVER UMBRELLA\s*w\/?BASE/i, price: 5150, sku: "FIN-CAN-UMB" },
  { match: /KINDLE LIVING HEATER/i, price: 5695, sku: "FIN-KIN-MIS-HEATER" },
  { match: /KINDLE LIVING LAMP/i, price: 5595, sku: "FIN-KIN-MIS-LAMP" },
  { match: /LIDO ROUND.*UMBRELLA|LIDO UMBRELLA(?!\s+COVER)/i, price: 950, sku: "FIN-MLN-UMB" },
  { match: /SQUARE PILLOW 17/i, price: 65, sku: "FIN-CAB-MIS-17X17" },
  { match: /SQUARE PILLOW 23/i, price: 95, sku: "FIN-CAB-MIS-23X23" },
  { match: /LUMBAR PILLOW 12/i, price: 65, sku: "FIN-CAB-MIS-12X24" },
  { match: /LAYLO LOUNGER,\s*NO RISERS/i, price: 599.99, sku: "FIN-TJM-MIS-LAYLO-NORISER" },
  { match: /LAYLO LOUNGER W\/4/i, price: 729.99, sku: "FIN-TJM-MIS-LAYLO-4RISER" },
  { match: /FREELO CHAIR/i, price: 499.99, sku: "FIN-TJM-CHA-FREELO" },
  { match: /TWO SHAYZ LOUNGERS FOR 5/i, price: 1599.99, sku: "FIN-TJM-MIS-SHAYZ-5" },
  { match: /MOON CHAIR/i, price: 749.99, sku: "FIN-TJM-CHA-MOON" },
  { match: /TWO WOOSAH/i, price: 1759.99, sku: "FIN-TJM-MIS-WOOSAH" },
  { match: /Ripple Table/i, price: 464.99, sku: "FIN-TJM-TAB" },
  { match: /PILLOW FOR LOUNGERS W\/POCKET|POCKET PILLOW/i, price: 154.99 },
  { match: /ONE 4 LB\.?\s*COATED LED? WEIGHT|4 LB\.?\s*COATED LEAD WEIGHT/i, price: 59.99 },
  { match: /LIDO UMBRELLA COVER/i, price: 100 },
  { match: /CANTILEVER UMBRELLA COVER/i, price: 150 },
];

export function normalizeDesc(s: string): string {
  return s
    .toUpperCase()
    .replace(/[""″]/g, '"')
    .replace(/[''′]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s*X\s*/gi, " X ")
    .replace(/\$/g, "")
    .trim();
}

export function parseMoneyLoose(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const HEADER_RE =
  /Drawing\s*Collections\s*Memo\/Description\s*MSRP\s*ALUMINUM/i;
const SECTION_RE =
  /^(SOFAS|COFFEE TABLES|DINING TABLES|DINING CHAIRS|OTTOMANS|SWINGS|UMBRELLAS)/i;
const FOOTER_RE =
  /Referral & Designer|Email Sales@|CC Patio Scottsdale|Prices are subject|^\*Prices/i;

/**
 * Parse page-delimited PDF text (from pypdf / pdf-parse) into Mia rows.
 * Metal rows: `Collection DESC $MSRP $ALUM`. Non-metal: `DESC` + `$PRICE` on next line.
 */
export function parseMiaAluminumPdfText(rawText: string): {
  pages: number;
  rows: Omit<MiaPdfRow, "matched_skus" | "price_review_flag" | "source">[];
} {
  const pageChunks = rawText.split(/===== PAGE (\d+) =====/);
  const rows: Omit<MiaPdfRow, "matched_skus" | "price_review_flag" | "source">[] = [];
  let pages = 0;

  // Format A: explicit page markers
  if (pageChunks.length > 1) {
    for (let i = 1; i < pageChunks.length; i += 2) {
      const pageNum = Number(pageChunks[i]);
      const body = pageChunks[i + 1] ?? "";
      pages = Math.max(pages, pageNum);
      rows.push(...parsePageBody(pageNum, body));
    }
  } else {
    pages = 1;
    rows.push(...parsePageBody(1, rawText));
  }

  return { pages, rows };
}

function parsePageBody(
  page: number,
  body: string,
): Omit<MiaPdfRow, "matched_skus" | "price_review_flag" | "source">[] {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !HEADER_RE.test(l))
    .filter((l) => !FOOTER_RE.test(l))
    .filter((l) => !SECTION_RE.test(l));

  const out: Omit<MiaPdfRow, "matched_skus" | "price_review_flag" | "source">[] = [];
  const moneyPair =
    /^(.+?)\s+\$([\d,]+(?:\.\d{2})?)\s+\$([\d,]+(?:\.\d{2})?)\s*$/;
  const moneySingle = /^\$([\d,]+(?:\.\d{2})?)\s*$/;
  const collections = new Set([
    "BRAVADA",
    "BROOKLYN",
    "OCEAN",
    "MILAN",
    "MISCELLANEOUS",
    "TENJAM",
    "N/A",
    "CABANA",
    "WATERFALL",
    "TAYLOR",
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^N\/A\s+ADD[- ]/i.test(line) && !/\$/.test(line)) continue;

    const pair = line.match(moneyPair);
    if (pair) {
      const left = pair[1]!.trim();
      const msrp = parseMoneyLoose(pair[2]!);
      const alu = parseMoneyLoose(pair[3]!);
      if (alu == null) continue;
      const { collection, description } = splitCollection(left, collections);
      out.push({
        page,
        collection,
        description,
        oct1_msrp: msrp,
        mia_aluminum_price: alu,
        category: "metal",
      });
      continue;
    }

    // Non-metal: description on this line, price on next
    const next = lines[i + 1];
    if (next && moneySingle.test(next) && !moneyPair.test(line) && !/\$/.test(line)) {
      const price = parseMoneyLoose(next.replace(/^\$/, ""));
      if (price == null) continue;
      const { collection, description } = splitCollection(line, collections);
      const isAccessory =
        /COVER|WEIGHT|POCKET|DEKTON|ADD-ON|ADD IRONWOOD|LED KIT|DOLLY|SIERRA|FLEXY/i.test(
          description,
        );
      out.push({
        page,
        collection,
        description,
        oct1_msrp: null,
        mia_aluminum_price: price,
        category: isAccessory ? "accessory" : "non_metal",
      });
      i += 1;
      continue;
    }

    // Same-line single price (rare)
    const singleInline = line.match(/^(.+?)\s+\$([\d,]+(?:\.\d{2})?)\s*$/);
    if (singleInline && !moneyPair.test(line)) {
      const price = parseMoneyLoose(singleInline[2]!);
      if (price == null) continue;
      const { collection, description } = splitCollection(
        singleInline[1]!.trim(),
        collections,
      );
      out.push({
        page,
        collection,
        description,
        oct1_msrp: null,
        mia_aluminum_price: price,
        category: "non_metal",
      });
    }
  }

  return out;
}

function splitCollection(
  left: string,
  collections: Set<string>,
): { collection: string; description: string } {
  // "Bravada BRAVADA CLUB..." or "Miscellaneous KINDLE..."
  const parts = left.split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0]!.toUpperCase();
    if (collections.has(first) || first === "BRAVADA" || /^[A-Z][a-z]+$/.test(parts[0]!)) {
      // Prefer title-case collection token when present
      if (/^[A-Z][a-z]+$/.test(parts[0]!) || collections.has(first)) {
        return {
          collection: parts[0]!,
          description: parts.slice(1).join(" "),
        };
      }
    }
  }
  return { collection: "", description: left };
}

export function flagOddDollarRows(
  rows: Array<Omit<MiaPdfRow, "matched_skus" | "price_review_flag" | "source">>,
): MiaPdfRow[] {
  const oddNorms = new Set(
    ODD_DOLLAR_PDF_ROWS.map((r) => normalizeDesc(r.pdfDescription)),
  );
  return rows.map((r) => {
    const norm = normalizeDesc(r.description);
    let flag: PriceReviewFlag = null;
    if (oddNorms.has(norm) || isOddDollarPrice(r.mia_aluminum_price)) {
      // Only flag the 6 known odd rows (metal integers ending 2/4/8/9 etc.)
      if (oddNorms.has(norm)) flag = PRICE_REVIEW_ODD;
    }
    return {
      ...r,
      matched_skus: [],
      price_review_flag: flag,
      source: "pdf" as const,
    };
  });
}

export function buildSyntheticMilanRows(): MiaPdfRow[] {
  return MISSING_MILAN_OTTOMANS.map((m) => {
    const expected = roundNearest5Alu(m.sowMsrp);
    if (expected !== m.aluminum) {
      throw new Error(
        `Milan ottoman ${m.sku} expected ${expected} got fixture ${m.aluminum}`,
      );
    }
    return {
      page: 0,
      collection: "Milan",
      description: m.name,
      oct1_msrp: m.sowMsrp,
      mia_aluminum_price: m.aluminum,
      category: "metal" as const,
      price_review_flag: PRICE_REVIEW_MISSING,
      matched_skus: [m.sku],
      source: "synthetic" as const,
    };
  });
}

export function lookupAliasPrice(
  sku: string,
  sowName: string,
): { pdfDescription: string; price: number } | null {
  const name = sowName.toUpperCase();
  for (const a of SOW_TO_PDF_ALIAS) {
    if (a.sku !== sku) continue;
    if (a.sowNameIncludes && !name.includes(a.sowNameIncludes.toUpperCase())) {
      continue;
    }
    if (a.sowNameExcludes && name.includes(a.sowNameExcludes.toUpperCase())) {
      continue;
    }
    return { pdfDescription: a.pdfDescription, price: a.price };
  }
  return null;
}

export function matchDescriptionToPdf(
  sowName: string,
  pdfRows: MiaPdfRow[],
): MiaPdfRow | null {
  const want = normalizeDesc(sowName);
  // Exact
  let hit = pdfRows.find((r) => normalizeDesc(r.description) === want);
  if (hit) return hit;
  // Strip collection prefix from SOW name if duplicated
  const stripped = want.replace(
    /^(BRAVADA|BROOKLYN|OCEAN|MILAN|CABANA|WATERFALL|TAYLOR)\s+/,
    "",
  );
  hit = pdfRows.find((r) => normalizeDesc(r.description) === stripped);
  if (hit) return hit;
  // Contains both ways (careful)
  const candidates = pdfRows.filter((r) => {
    const d = normalizeDesc(r.description);
    return d.includes(stripped) || stripped.includes(d);
  });
  if (candidates.length === 1) return candidates[0]!;
  // Dimensional token overlap
  const wantDims: string[] = want.match(/\d+/g) ?? [];
  let best: MiaPdfRow | null = null;
  let bestScore = 0;
  const familyTokens = [
    "CLUB",
    "SWIVEL",
    "LOVESEAT",
    "SOFA",
    "CHAISE",
    "DAYBED",
    "OTTOMAN",
    "TABLE",
    "BENCH",
    "BARSTOOL",
    "SWING",
    "UMBRELLA",
    "PILLOW",
    "HEATER",
    "LAMP",
    "LAYLO",
    "FREELO",
    "SHAYZ",
    "WOOSAH",
    "MOON",
    "RIPPLE",
    "STAR",
    "DAISY",
    "FLY",
    "WATERFALL",
    "TAYLOR",
    "DINING",
  ] as const;
  for (const r of pdfRows) {
    const d = normalizeDesc(r.description);
    // Require shared product family keyword
    const family =
      want.split(" ").find((w) =>
        (familyTokens as readonly string[]).includes(w),
      ) ?? "";
    if (family && !d.includes(family)) continue;
    const haveDims: string[] = d.match(/\d+/g) ?? [];
    let score = 0;
    for (const n of wantDims) if (haveDims.includes(n)) score += 2;
    if (family && d.includes(family)) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore >= 5 ? best : null;
}

export function buildSkuPriceIndex(rows: MiaPdfRow[]): MiaPdfFixture["sku_price_index"] {
  const index: MiaPdfFixture["sku_price_index"] = {};
  for (const r of rows) {
    for (const sku of r.matched_skus) {
      index[sku] = {
        price: r.mia_aluminum_price,
        flag: r.price_review_flag,
        source: r.source,
        pdf_description: r.description,
        oct1_msrp: r.oct1_msrp,
      };
    }
  }
  // Non-metal explicit SKU map
  for (const n of NON_METAL_PDF_PRICES) {
    if (!n.sku) continue;
    const row = rows.find((r) => n.match.test(r.description));
    if (row) {
      index[n.sku] = {
        price: n.price,
        flag: row.price_review_flag,
        source: "pdf",
        pdf_description: row.description,
        oct1_msrp: row.oct1_msrp,
      };
      if (!row.matched_skus.includes(n.sku)) row.matched_skus.push(n.sku);
    }
  }
  return index;
}

export function resolveWebsitePriceFromFixture(
  fixture: MiaPdfFixture,
  input: {
    sku: string;
    wooSku?: string;
    sowName?: string;
    fallbackSteel?: number | null;
    framePolicy?: string;
  },
): number | null {
  const candidates = [input.wooSku, input.sku].filter(Boolean) as string[];
  for (const c of candidates) {
    const hit = fixture.sku_price_index[c];
    if (hit) return hit.price;
  }
  // Alias strip -LS/-RS
  for (const c of candidates) {
    const base = c.replace(/-(LS|RS)$/i, "");
    const hit = fixture.sku_price_index[base];
    if (hit) return hit.price;
  }
  if (input.sowName) {
    const row = matchDescriptionToPdf(input.sowName, fixture.rows);
    if (row) return row.mia_aluminum_price;
    const alias = lookupAliasPrice(input.sku, input.sowName);
    if (alias) return alias.price;
  }
  return null;
}

export function phase1SpotCheckSkus(): string[] {
  return [
    ...MISSING_MILAN_OTTOMANS.map((m) => m.sku),
    "FIN-BRK-DIN-TAB-36X36",
    "FIN-WFT-DIN-BCH-96X22",
    "FIN-WFT-FLY-BST-18X18",
  ];
}

export function readPriceReviewFlag(
  attributes: Record<string, unknown> | null | undefined,
): PriceReviewFlag {
  const raw = attributes?.price_review_flag;
  if (raw === PRICE_REVIEW_MISSING || raw === PRICE_REVIEW_ODD) return raw;
  return null;
}
