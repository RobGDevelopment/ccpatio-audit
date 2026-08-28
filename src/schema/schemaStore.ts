/**
 * Zustand Control Plane store — master schema + selected work order.
 */

"use client";

import { create } from "zustand";
import type { MasterWorkflowSchema } from "./schemaTypes";
import { parseMasterSchema } from "./schemaTypes";
import { buildSeedFromLegacy } from "./buildSeedFromLegacy";

export type ControlPlaneView = "topology" | "gantt";

type SchemaStore = {
  schema: MasterWorkflowSchema;
  selectedMoId: string | null;
  controlPlaneView: ControlPlaneView;
  dirty: boolean;
  revision: number;

  setControlPlaneView: (v: ControlPlaneView) => void;
  setSelectedMoId: (moId: string | null) => void;
  replaceSchema: (schema: MasterWorkflowSchema) => void;
  resetToSeed: () => void;
  markClean: () => void;
  markDirty: () => void;
};

export const useSchemaStore = create<SchemaStore>((set, get) => {
  const seed = buildSeedFromLegacy();
  return {
    schema: seed,
    selectedMoId: seed.workOrders[0]?.moId ?? null,
    controlPlaneView: "topology",
    dirty: false,
    revision: 0,

    setControlPlaneView: (v) => set({ controlPlaneView: v }),
    setSelectedMoId: (moId) => set({ selectedMoId: moId }),
    replaceSchema: (schema) =>
      set((s) => ({
        schema: parseMasterSchema(schema),
        dirty: true,
        revision: s.revision + 1,
      })),
    resetToSeed: () => {
      const next = buildSeedFromLegacy();
      set({
        schema: next,
        dirty: false,
        revision: get().revision + 1,
        selectedMoId: next.workOrders[0]?.moId ?? null,
      });
    },
    markClean: () => set({ dirty: false }),
    markDirty: () => set({ dirty: true }),
  };
});
