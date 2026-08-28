"use client";

import { useEffect, useRef } from "react";
import { useTopologyStore } from "./topology/topologyStore";
import { EXHAUSTIVE_OPERATIONAL_TASKS } from "../schema/exhaustiveOperationalSeed";
import { OPERATIONAL_ZONES } from "../schema/operationalTask";
import type { WorkflowStep } from "../schema/schemaTypes";

const ZONE_SET = new Set<string>(OPERATIONAL_ZONES);

function needsExhaustiveReseed(tasks: { id: string; zone: string }[]): boolean {
  if (tasks.length < 96) return true;
  return tasks.some((task) => !ZONE_SET.has(task.zone));
}

interface Props {
  initialBlueprint: WorkflowStep[];
  children: React.ReactNode;
}

export function CommandCenterHydrator({ children }: Props) {
  const seeded = useRef(false);

  useEffect(() => {
    const seedIfStale = () => {
      if (seeded.current) return;
      seeded.current = true;
      const { operationalTasks, importTasks } = useTopologyStore.getState();
      if (needsExhaustiveReseed(operationalTasks)) {
        importTasks(EXHAUSTIVE_OPERATIONAL_TASKS);
      }
    };

    if (useTopologyStore.persist.hasHydrated()) {
      seedIfStale();
      return;
    }

    return useTopologyStore.persist.onFinishHydration(seedIfStale);
  }, []);

  return <>{children}</>;
}
