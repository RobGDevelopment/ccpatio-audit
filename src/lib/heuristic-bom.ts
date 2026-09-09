/**
 * Volumetric MTO recipe guesses for VividWorks Phase 1/2 finished goods.
 *
 * Emits a FRAME / CUSH tree with generic placeholders (RM-FAB-GENERIC,
 * RM-PWD-GENERIC, RM-DKT-GENERIC-SLAB). Never expands colorways.
 */

export const RM_PWD_GENERIC = "RM-PWD-GENERIC";
export const RM_FAB_GENERIC = "RM-FAB-GENERIC";
export const RM_FOAM = "RM-RAW-FOAM";
export const RM_TUBING_2X2 = "RM-MET-2X2-TUBING";
export const RM_CAP_2X2 = "RM-HRD-2X2-METAL-CAP";
export const RM_DKT_GENERIC = "RM-DKT-GENERIC-SLAB";

export type HeuristicSlots = {
  fabric: boolean;
  powder: boolean;
  dekton: boolean;
  pillow: boolean;
};

export type HeuristicBomLine = {
  parentSku: string;
  childSku: string;
  quantity: number;
  scrapFactor: number;
  unitOfMeasure: string;
  notes: string;
};

export type HeuristicOperation = {
  itemSku: string;
  workCenter: string;
  sequence: number;
  runTimeMins: number;
};

export type HeuristicPlan = {
  finSku: string;
  frameSku: string | null;
  cushSku: string | null;
  family: "seating" | "table" | "skip";
  skippedReason: string | null;
  hubSkus: Array<{
    globalSku: string;
    itemType: "finished_good" | "sub_assembly";
    originalName: string;
    category: string;
  }>;
  lines: HeuristicBomLine[];
  operations: HeuristicOperation[];
};

export type HeuristicInput = {
  sowName: string;
  canonicalSku: string;
  collection: string;
  length: string;
  depth: string;
  height: string;
  slots: HeuristicSlots;
};

const CUSHION_NAME =
  /sofa|loveseat|chair|chaise|ottoman|cushion|daybed|barstool|bench|swing/i;
const TABLE_NAME = /table|fire\s*pit/i;
const SKIP_NAME =
  /cover|umbrella|weight|riser|lamp|pillow for|dekton slab|weatherproof|unfabricated|base\b|shade system|ironwood/i;

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function inches(raw: string): number {
  const digits = String(raw ?? "").replace(/[^\d.]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function parseNamedDimensions(name: string): {
  length: string;
  depth: string;
  height: string;
} {
  const empty = { length: "", depth: "", height: "" };
  if (!name) return empty;
  const diameter = name.match(/(\d{2,3})\s*["']?\s*(?:diameter|dia\.?)\b/i);
  if (diameter?.[1]) {
    return { length: diameter[1], depth: diameter[1], height: "" };
  }
  const triple = name.match(
    /(\d{2,3})\s*["']?\s*[x×]\s*(\d{2,3})\s*["']?(?:\s*[x×]\s*(\d{2,3}))?/i,
  );
  if (triple?.[1] && triple[2]) {
    return {
      length: triple[1],
      depth: triple[2],
      height: triple[3] ?? "",
    };
  }
  return empty;
}

export function subAssemblySku(
  finSku: string,
  role: "FRAME" | "CUSH",
): string {
  const stem = finSku.replace(/^FIN-/, "");
  return `SA-${stem}-${role}`;
}

export function classifyFamily(
  name: string,
): HeuristicPlan["family"] {
  if (SKIP_NAME.test(name) && !CUSHION_NAME.test(name) && !TABLE_NAME.test(name)) {
    return "skip";
  }
  if (CUSHION_NAME.test(name)) return "seating";
  if (TABLE_NAME.test(name)) return "table";
  return "skip";
}

export function tubingFeet(lengthIn: number, depthIn: number, heightIn: number): number {
  const h = heightIn > 0 ? heightIn : 30;
  return round4(2 * (lengthIn + depthIn) / 12 + (4 * h) / 12);
}

/** Two faces including back rest so a 72×34×31 sofa ≈ 8 yd before scrap. */
export function fabricYards(
  lengthIn: number,
  depthIn: number,
  heightIn: number,
  pillow: boolean,
): number {
  const h = heightIn > 0 ? heightIn : depthIn;
  const faces = (2 * lengthIn * (depthIn + h)) / 1296;
  return round4(Math.max(0.5, faces + (pillow ? 1 : 0)));
}

export function foamBoardFeet(lengthIn: number, depthIn: number): number {
  return round4(Math.max(0.5, (lengthIn * depthIn * 4) / 144));
}

export function powderPounds(tubingFt: number): number {
  return round4(Math.max(0.1, 0.08 * tubingFt));
}

function line(
  parentSku: string,
  childSku: string,
  quantity: number,
  scrapFactor: number,
  unitOfMeasure: string,
  notes: string,
): HeuristicBomLine {
  return {
    parentSku,
    childSku,
    quantity: round4(quantity),
    scrapFactor: round4(scrapFactor),
    unitOfMeasure,
    notes,
  };
}

const FRAME_OPS = [
  { workCenter: "Metal Cutting", sequence: 10, runTimeMins: 12 },
  { workCenter: "Building & Welding", sequence: 20, runTimeMins: 25 },
  { workCenter: "Metal Powder Coating", sequence: 30, runTimeMins: 18 },
];

const CUSH_OPS = [
  { workCenter: "Fabric Cutting", sequence: 10, runTimeMins: 10 },
  { workCenter: "Fabric Sewing", sequence: 20, runTimeMins: 22 },
  { workCenter: "Cushion Stuffing", sequence: 30, runTimeMins: 14 },
];

const FG_OPS = [
  { workCenter: "Quality Check", sequence: 10, runTimeMins: 8 },
];

export function buildHeuristicPlan(input: HeuristicInput): HeuristicPlan {
  const finSku = input.canonicalSku.trim().toUpperCase();
  const named = parseNamedDimensions(input.sowName);
  const lengthIn = inches(named.length || input.length);
  const depthIn = inches(named.depth || input.depth);
  const heightIn = inches(named.height || input.height);
  const family = classifyFamily(input.sowName);
  const collection = input.collection.trim() || "Finished Good";

  const hubSkus: HeuristicPlan["hubSkus"] = [
    {
      globalSku: finSku,
      itemType: "finished_good",
      originalName: input.sowName,
      category: collection,
    },
  ];

  if (!finSku.startsWith("FIN-")) {
    return {
      finSku,
      frameSku: null,
      cushSku: null,
      family: "skip",
      skippedReason: "SKU is not a FIN-* finished good",
      hubSkus,
      lines: [],
      operations: [],
    };
  }

  if (family === "skip") {
    return {
      finSku,
      frameSku: null,
      cushSku: null,
      family,
      skippedReason: "Accessory / underspecified — manager authors the cut-list",
      hubSkus,
      lines: [],
      operations: [],
    };
  }

  if (lengthIn < 8 || depthIn < 8) {
    return {
      finSku,
      frameSku: null,
      cushSku: null,
      family: "skip",
      skippedReason: "Missing length/depth — cannot estimate volumes",
      hubSkus,
      lines: [],
      operations: [],
    };
  }

  const frameSku = subAssemblySku(finSku, "FRAME");
  const cushSku = family === "seating" ? subAssemblySku(finSku, "CUSH") : null;
  hubSkus.push({
    globalSku: frameSku,
    itemType: "sub_assembly",
    originalName: `${input.sowName} FRAME`,
    category: collection,
  });
  if (cushSku) {
    hubSkus.push({
      globalSku: cushSku,
      itemType: "sub_assembly",
      originalName: `${input.sowName} CUSH`,
      category: collection,
    });
  }

  const ft = tubingFeet(lengthIn, depthIn, heightIn);
  const lines: HeuristicBomLine[] = [
    line(finSku, frameSku, 1, 1, "ea", "FG consumes one welded frame"),
  ];
  if (cushSku) {
    lines.push(line(finSku, cushSku, 1, 1, "ea", "FG consumes one cushion set"));
  }

  lines.push(
    line(
      frameSku,
      RM_TUBING_2X2,
      ft,
      1.08,
      "ft",
      `Rails + legs from ${lengthIn}x${depthIn}x${heightIn || 30}`,
    ),
    line(frameSku, RM_CAP_2X2, family === "seating" ? 4 : 4, 1, "ea", "2x2 end caps"),
    line(
      frameSku,
      RM_PWD_GENERIC,
      powderPounds(ft),
      1.05,
      "lb",
      "MTO powder placeholder — swap PWD-* at order time",
    ),
  );

  if (input.slots.dekton || (family === "table" && /dekton|fire/i.test(input.sowName))) {
    lines.push(
      line(
        frameSku,
        RM_DKT_GENERIC,
        1,
        1,
        "slab",
        "MTO dekton placeholder — swap STN-* at order time",
      ),
    );
  }

  if (cushSku && (input.slots.fabric || family === "seating")) {
    lines.push(
      line(
        cushSku,
        RM_FAB_GENERIC,
        fabricYards(lengthIn, depthIn, heightIn, input.slots.pillow),
        1.1,
        "yd",
        "MTO fabric placeholder — swap FAB-* at order time",
      ),
      line(
        cushSku,
        RM_FOAM,
        foamBoardFeet(lengthIn, depthIn),
        1.05,
        "boardft",
        "4in seat slab",
      ),
    );
  }

  const operations: HeuristicOperation[] = [
    ...FG_OPS.map((op) => ({ ...op, itemSku: finSku })),
    ...FRAME_OPS.map((op) => ({ ...op, itemSku: frameSku })),
  ];
  if (cushSku) {
    operations.push(...CUSH_OPS.map((op) => ({ ...op, itemSku: cushSku })));
  }
  if (input.slots.dekton) {
    operations.push({
      itemSku: frameSku,
      workCenter: "Dekton Cutting",
      sequence: 40,
      runTimeMins: 20,
    });
  }

  return {
    finSku,
    frameSku,
    cushSku,
    family,
    skippedReason: null,
    hubSkus,
    lines,
    operations,
  };
}
