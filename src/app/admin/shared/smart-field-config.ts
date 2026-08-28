/** Input typing for PIM attribute / catalog fields (ERP-safe). */

export type SmartFieldKind = "text" | "number" | "select";

export type SmartFieldMeta = {
  kind: SmartFieldKind;
  step?: string;
  min?: string;
  options?: readonly string[];
};

const NUMERIC_STEP = "0.01";

/** Maps descriptor key or patchField → strict input control. */
export const SMART_FIELD_CONFIG: Record<string, SmartFieldMeta> = {
  base_cost: { kind: "number", step: NUMERIC_STEP, min: "0" },
  msrp: { kind: "number", step: NUMERIC_STEP, min: "0" },
  length: { kind: "number", step: NUMERIC_STEP, min: "0" },
  width: { kind: "number", step: NUMERIC_STEP, min: "0" },
  height: { kind: "number", step: NUMERIC_STEP, min: "0" },
  seat_height: { kind: "number", step: NUMERIC_STEP, min: "0" },
  arm_height: { kind: "number", step: NUMERIC_STEP, min: "0" },
  weight: { kind: "number", step: NUMERIC_STEP, min: "0" },
  slab_length: { kind: "number", step: NUMERIC_STEP, min: "0" },
  slab_width: { kind: "number", step: NUMERIC_STEP, min: "0" },
  thickness_mm: { kind: "number", step: "0.1", min: "0" },
  yield_sqft: { kind: "number", step: NUMERIC_STEP, min: "0" },
  roll_width: { kind: "number", step: NUMERIC_STEP, min: "0" },
  pattern_repeat: { kind: "number", step: NUMERIC_STEP, min: "0" },
  rub_count: { kind: "number", step: "1", min: "0" },
  wall_thickness: { kind: "number", step: "0.001", min: "0" },
  stock_length: { kind: "number", step: NUMERIC_STEP, min: "0" },
  cure_temp: { kind: "number", step: "1", min: "0" },
  cure_time: { kind: "number", step: "1", min: "0" },
  grade: {
    kind: "select",
    options: ["A", "B", "C", "D", "E", "F"],
  },
  finish: {
    kind: "select",
    options: ["Matte", "Polished", "Satin", "Textured", "Leathered"],
  },
  finish_type: {
    kind: "select",
    options: ["Matte", "Gloss", "Satin", "Textured", "Metallic"],
  },
  profile_type: {
    kind: "select",
    options: [
      "Extrusion",
      "Tube",
      "Angle",
      "Channel",
      "Flat Bar",
      "Round Bar",
      "Square Tube",
      "Rect Tube",
      "Sheet",
      "Other",
    ],
  },
};

export function resolveSmartFieldMeta(
  key: string,
  patchField?: string,
): SmartFieldMeta {
  return (
    SMART_FIELD_CONFIG[key] ??
    (patchField ? SMART_FIELD_CONFIG[patchField] : undefined) ?? {
      kind: "text",
    }
  );
}

export function isNumericFieldKey(key: string, patchField?: string): boolean {
  return resolveSmartFieldMeta(key, patchField).kind === "number";
}
