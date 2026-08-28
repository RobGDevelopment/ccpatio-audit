/**
 * Katana MRP execution wrapper (V8).
 *
 * Create Manufacturing Order is the only mutating path this module owns.
 * Live request/response JSON is NOT confirmed: Katana_Data_Schema.md and
 * katana_api_logic.md are EMPTY (401 on scrape). This service therefore:
 *   - never invents numeric variant_id / material_id values
 *   - looks up Katana IDs from sku_mappings via SkuMappingLookup
 *   - sends HTTP Idempotency-Key (opportunity_id, else woo-{orderId})
 *   - no-ops when DOWNSTREAM_MUTATIONS is not "true"
 *
 * Reconcile KatanaManufacturingOrderBody against a real MO export before
 * flipping DOWNSTREAM_MUTATIONS on.
 */

import type { GlobalE2ESku } from "../../generated/global-e2e-skus";
import type {
  WooLineItem,
  WooMetaDatum,
  WooOrderWebhook,
} from "../woocommerce/ingress.schema";
import { isGlobalE2eSku } from "../woocommerce/ingress.schema";

const KATANA_API_BASE = "https://api.katanamrp.com/v1";
const CREATE_MO_PATH = "/manufacturing_orders";

export type BomRole =
  | "product"
  | "fabric"
  | "stone"
  | "shade"
  | "frame"
  | "powder"
  | "furniture"
  | "firepit"
  | "unknown";

export type BomComponent = {
  role: BomRole;
  sku: GlobalE2ESku;
  /** Katana variant_id from sku_mappings — never guessed. */
  variant_id: number | null;
  /** Katana material_id from sku_mappings — never guessed. */
  material_id: number | null;
  quantity: number;
};

/**
 * Outbound MO body. Field names follow Katana v1 conventions used by
 * scripts/extract-katana-baseline.js (`/variants`, `/recipes`) plus the
 * factory expectation of variant_id + recipe/material rows. Confirm against
 * a live Create MO payload before production.
 */
export type KatanaManufacturingOrderBody = {
  variant_id: number | null;
  sku: GlobalE2ESku;
  quantity: number;
  additional_info: string;
  production_deadline_date?: string;
  location_id?: number;
  materials: Array<{
    sku: GlobalE2ESku;
    variant_id: number | null;
    material_id: number | null;
    quantity: number;
    notes: string;
  }>;
};

export type CreateMoResult =
  | { status: "created"; mo_id: string; body: KatanaManufacturingOrderBody }
  | { status: "already_exists"; mo_id: string }
  | { status: "dry_run"; mo_id: null; body: KatanaManufacturingOrderBody };

export type MapToKatanaMoInput = {
  validatedPayload: WooOrderWebhook;
  /** GHL opportunity id — preferred Idempotency-Key (CCR / architecture). */
  opportunityId?: string | null;
  locationId?: number;
  productionDeadlineDate?: string;
};

/** Resolves Global E2E SKU → Katana IDs. Implementations read sku_mappings only. */
export interface SkuMappingLookup {
  resolve(sku: GlobalE2ESku): Promise<{
    variant_id: number | null;
    material_id: number | null;
  }>;
}

/** Local MO index so retries do not POST twice even if Katana ignores the header. */
export interface KatanaMoIndex {
  getMoId(externalRef: string): Promise<string | null>;
  saveMoId(externalRef: string, moId: string): Promise<void>;
}

export type KatanaServiceOptions = {
  apiKey: string;
  skuLookup: SkuMappingLookup;
  moIndex?: KatanaMoIndex;
  fetchImpl?: typeof fetch;
  /** Defaults to process.env.DOWNSTREAM_MUTATIONS === "true" */
  downstreamMutations?: boolean;
  apiBase?: string;
};

const META_KEY_TO_ROLE: Record<string, BomRole> = {
  cushion_fabric: "fabric",
  fabric: "fabric",
  "cushion-fabric": "fabric",
  stone: "stone",
  dekton: "stone",
  shade: "shade",
  umbrella: "shade",
  scolaro: "shade",
  frame: "frame",
  "frame-type": "frame",
  frame_type: "frame",
  powder: "powder",
  powder_coat: "powder",
  "powder-coat": "powder",
  furniture: "furniture",
  tenjam: "furniture",
  firepit: "firepit",
};

function normalizeMetaKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^attribute_/, "")
    .replace(/^pa_/, "")
    .replace(/^_/, "")
    .replace(/\s+/g, "_");
}

function metaString(entry: WooMetaDatum): string | null {
  if (typeof entry.value !== "string") return null;
  const trimmed = entry.value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildExternalRef(input: {
  opportunityId?: string | null;
  wooOrderId: number;
}): string {
  const opp = input.opportunityId?.trim();
  if (opp) return `ghl:${opp}`;
  return `woo:${input.wooOrderId}`;
}

export function buildIdempotencyKey(externalRef: string): string {
  return externalRef;
}

/**
 * Unpack a validated Woo line into BOM rows.
 * Example: Cabana line sku + meta.cushion_fabric=FAB-ACT-ASH + meta.dekton=STN-DKT-AT2.0
 */
export function unpackLineItemBom(item: WooLineItem): Array<{
  role: BomRole;
  sku: GlobalE2ESku;
  quantity: number;
}> {
  const rows: Array<{ role: BomRole; sku: GlobalE2ESku; quantity: number }> = [
    { role: "product", sku: item.sku, quantity: item.quantity },
  ];

  for (const entry of item.meta_data) {
    const role = META_KEY_TO_ROLE[normalizeMetaKey(entry.key)];
    if (!role) continue;
    const value = metaString(entry);
    if (!value || !isGlobalE2eSku(value)) continue;
    rows.push({ role, sku: value, quantity: item.quantity });
  }

  return rows;
}

function missingKatanaIds(components: BomComponent[]): BomComponent[] {
  return components.filter((row) => row.variant_id == null && row.material_id == null);
}

/**
 * Translate a Zod-validated Woo order into a Katana Create MO body.
 * Looks up variant_id / material_id from sku_mappings — does not invent IDs.
 */
export async function mapToKatanaMO(
  input: MapToKatanaMoInput,
  skuLookup: SkuMappingLookup,
): Promise<{
  externalRef: string;
  idempotencyKey: string;
  orders: KatanaManufacturingOrderBody[];
}> {
  const { validatedPayload, opportunityId, locationId, productionDeadlineDate } =
    input;
  const externalRef = buildExternalRef({
    opportunityId,
    wooOrderId: validatedPayload.id,
  });
  const idempotencyKey = buildIdempotencyKey(externalRef);

  const customer = [
    validatedPayload.billing?.first_name,
    validatedPayload.billing?.last_name,
  ]
    .filter(Boolean)
    .join(" ");

  const orders: KatanaManufacturingOrderBody[] = [];

  for (const line of validatedPayload.line_items) {
    const unpacked = unpackLineItemBom(line);
    const materials: BomComponent[] = [];

    for (const row of unpacked) {
      const ids = await skuLookup.resolve(row.sku);
      materials.push({
        role: row.role,
        sku: row.sku,
        variant_id: ids.variant_id,
        material_id: ids.material_id,
        quantity: row.quantity,
      });
    }

    const product = materials.find((row) => row.role === "product") ?? materials[0];
    if (!product) {
      throw new Error(`Line ${line.id ?? line.name} produced an empty BOM.`);
    }

    const unmapped = missingKatanaIds(materials);
    if (unmapped.length > 0) {
      const skus = unmapped.map((row) => row.sku).join(", ");
      throw new Error(
        `sku_mappings missing Katana variant_id/material_id for: ${skus}. Fail closed — no MO.`,
      );
    }

    orders.push({
      variant_id: product.variant_id,
      sku: product.sku,
      quantity: line.quantity,
      location_id: locationId,
      production_deadline_date: productionDeadlineDate,
      additional_info: [
        `external_ref=${externalRef}`,
        `woo_order=${validatedPayload.id}`,
        `woo_line=${line.id ?? "n/a"}`,
        `product=${line.name}`,
        customer ? `customer=${customer}` : null,
        ...materials
          .filter((row) => row.role !== "product")
          .map((row) => `bom.${row.role}=${row.sku}`),
      ]
        .filter(Boolean)
        .join(" | "),
      materials: materials.map((row) => ({
        sku: row.sku,
        variant_id: row.variant_id,
        material_id: row.material_id,
        quantity: row.quantity,
        notes: row.role,
      })),
    });
  }

  if (orders.length === 0) {
    throw new Error("Validated Woo payload contained no line items to map.");
  }

  return { externalRef, idempotencyKey, orders };
}

export class KatanaService {
  private readonly apiKey: string;
  private readonly skuLookup: SkuMappingLookup;
  private readonly moIndex: KatanaMoIndex | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly downstreamMutations: boolean;
  private readonly apiBase: string;

  constructor(options: KatanaServiceOptions) {
    this.apiKey = options.apiKey;
    this.skuLookup = options.skuLookup;
    this.moIndex = options.moIndex;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.downstreamMutations =
      options.downstreamMutations ?? process.env.DOWNSTREAM_MUTATIONS === "true";
    this.apiBase = options.apiBase ?? KATANA_API_BASE;
  }

  /**
   * Create one Katana MO per Woo line item. Idempotent on
   * ghl:{opportunityId} or woo:{orderId}.
   */
  async createManufacturingOrders(input: MapToKatanaMoInput): Promise<CreateMoResult[]> {
    const mapped = await mapToKatanaMO(input, this.skuLookup);
    const results: CreateMoResult[] = [];

    for (const [index, body] of mapped.orders.entries()) {
      const lineRef = `${mapped.externalRef}:line:${index}`;
      const idempotencyKey = `${mapped.idempotencyKey}:line:${index}`;
      results.push(await this.createOne(lineRef, idempotencyKey, body));
    }

    return results;
  }

  private async createOne(
    externalRef: string,
    idempotencyKey: string,
    body: KatanaManufacturingOrderBody,
  ): Promise<CreateMoResult> {
    const existing = await this.moIndex?.getMoId(externalRef);
    if (existing) {
      return { status: "already_exists", mo_id: existing };
    }

    if (!this.downstreamMutations) {
      return { status: "dry_run", mo_id: null, body };
    }

    const response = await this.fetchImpl(`${this.apiBase}${CREATE_MO_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(this.toKatanaJson(body)),
    });

    if (response.status === 409) {
      const replayed = await this.readMoId(response);
      if (replayed) {
        await this.moIndex?.saveMoId(externalRef, replayed);
        return { status: "already_exists", mo_id: replayed };
      }
      throw new Error(
        `Katana returned 409 for ${externalRef} but no MO id was in the body.`,
      );
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Katana Create MO failed (${response.status}) for ${externalRef}: ${detail}`,
      );
    }

    const moId = await this.readMoId(response);
    if (!moId) {
      throw new Error(`Katana Create MO succeeded without an id for ${externalRef}.`);
    }

    await this.moIndex?.saveMoId(externalRef, moId);
    return { status: "created", mo_id: moId, body };
  }

  /**
   * Wire to the live Katana Create MO JSON here once Katana_Data_Schema.md
   * has a scraped example. Until then we send sku + looked-up IDs only.
   */
  private toKatanaJson(body: KatanaManufacturingOrderBody): Record<string, unknown> {
    return {
      variant_id: body.variant_id,
      sku: body.sku,
      quantity: body.quantity,
      additional_info: body.additional_info,
      production_deadline_date: body.production_deadline_date,
      location_id: body.location_id,
      materials: body.materials.map((row) => ({
        sku: row.sku,
        variant_id: row.variant_id,
        material_id: row.material_id,
        quantity: row.quantity,
        notes: row.notes,
      })),
    };
  }

  private async readMoId(response: Response): Promise<string | null> {
    const payload = (await response.clone().json().catch(() => null)) as {
      id?: number | string;
      data?: { id?: number | string };
    } | null;
    const id = payload?.id ?? payload?.data?.id;
    return id == null ? null : String(id);
  }
}
