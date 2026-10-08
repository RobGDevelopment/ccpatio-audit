/**
 * Seed adapter. The topology graph this used to compile was removed.
 * Callers still receive a valid empty master schema plus demo work orders.
 */

import type { MasterWorkflowSchema } from "./schemaTypes";
import { buildDemoWorkOrders } from "./demoWorkOrders";

export function buildSeedFromLegacy(): MasterWorkflowSchema {
  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    sourceFiles: [],
    zones: [],
    nodes: [],
    edges: [],
    workflows: [],
    workOrders: buildDemoWorkOrders(),
  };
}
