export const OPERATIONAL_ZONES = [
  "Zone 0: Inbound Marketing",
  "Zone 1: CRM / Inbound Triage",
  "Zone 2: CRM Pipeline",
  "Zone 3: Showroom Sales (AZ/CA)",
  "Zone 4: Design & Cut Lists",
  "Zone 5: Middleware Core",
  "Zone 6: Factory Production & QA",
  "Zone 7: Logistics Dispatch",
  "Zone 8: Treasury & Post-Care",
] as const;

export type OperationalZone = (typeof OPERATIONAL_ZONES)[number];

export const OPERATIONAL_NODE_TYPES = [
  "standard",
  "gateway",
  "milestone",
] as const;

export type OperationalNodeType = (typeof OPERATIONAL_NODE_TYPES)[number];

export function coerceOperationalNodeType(value: unknown): OperationalNodeType {
  if (
    typeof value === "string" &&
    (OPERATIONAL_NODE_TYPES as readonly string[]).includes(value)
  ) {
    return value as OperationalNodeType;
  }
  return "standard";
}

const LEGACY_ZONE_ALIASES: Record<string, OperationalZone> = {
  "Sales/GHL": "Zone 3: Showroom Sales (AZ/CA)",
  Procurement: "Zone 5: Middleware Core",
  "Metal Fabrication": "Zone 6: Factory Production & QA",
  "Powder Coating": "Zone 6: Factory Production & QA",
  Assembly: "Zone 6: Factory Production & QA",
  Delivery: "Zone 7: Logistics Dispatch",
  "Accounting/Admin": "Zone 8: Treasury & Post-Care",
};

export function coerceOperationalZone(value: unknown): OperationalZone {
  if (typeof value === "string") {
    if ((OPERATIONAL_ZONES as readonly string[]).includes(value)) {
      return value as OperationalZone;
    }
    if (LEGACY_ZONE_ALIASES[value]) return LEGACY_ZONE_ALIASES[value];
  }
  return "Zone 0: Inbound Marketing";
}

export interface OperationalTask {
  id: string;
  title: string;
  zone: OperationalZone;
  duration: string;
  dependencies: string[];
  inputsRequired: string[];
  outputsGenerated: string[];
  digitalTriggers: string[];
  techStack: string[];
  nodeType?: OperationalNodeType;
}

export const OPERATIONAL_ZONE_ACCENT: Record<OperationalZone, string> = {
  "Zone 0: Inbound Marketing": "#818cf8",
  "Zone 1: CRM / Inbound Triage": "#6366f1",
  "Zone 2: CRM Pipeline": "#a78bfa",
  "Zone 3: Showroom Sales (AZ/CA)": "#8b5cf6",
  "Zone 4: Design & Cut Lists": "#c084fc",
  "Zone 5: Middleware Core": "#22d3ee",
  "Zone 6: Factory Production & QA": "#fbbf24",
  "Zone 7: Logistics Dispatch": "#34d399",
  "Zone 8: Treasury & Post-Care": "#10b981",
};

export function createEmptyOperationalTask(
  id: string,
  overrides: Partial<OperationalTask> = {}
): OperationalTask {
  return {
    id,
    title: "New Operational Task",
    zone: "Zone 0: Inbound Marketing",
    duration: "1d",
    dependencies: [],
    inputsRequired: [],
    outputsGenerated: [],
    digitalTriggers: [],
    techStack: [],
    nodeType: "standard",
    ...overrides,
  };
}

export function parseDurationDays(duration: string): number {
  const match = duration.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const value = Number(match[1]);
  if (duration.toLowerCase().includes("h")) return Math.max(0, value / 24);
  return Math.max(0, value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseOperationalTasks(data: unknown): OperationalTask[] {
  const source = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { tasks?: unknown }).tasks)
      ? (data as { tasks: unknown[] }).tasks
      : null;

  if (!source) {
    throw new Error("Blueprint JSON must be an array of operational tasks.");
  }

  return source.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Invalid task at index ${index}.`);
    }
    const task = item as Record<string, unknown>;
    if (typeof task.id !== "string" || typeof task.title !== "string") {
      throw new Error(`Task at index ${index} is missing id or title.`);
    }
    return {
      id: task.id,
      title: task.title,
      zone: coerceOperationalZone(task.zone),
      duration: typeof task.duration === "string" ? task.duration : "1d",
      dependencies: asStringArray(task.dependencies),
      inputsRequired: asStringArray(task.inputsRequired),
      outputsGenerated: asStringArray(task.outputsGenerated),
      digitalTriggers: asStringArray(task.digitalTriggers),
      techStack: asStringArray(task.techStack),
      nodeType: coerceOperationalNodeType(task.nodeType),
    };
  });
}
