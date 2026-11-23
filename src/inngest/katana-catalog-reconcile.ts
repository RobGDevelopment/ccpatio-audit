/**
 * Scheduled 2-hour throttled Katana → Hub self-healing cron + manual trigger.
 * Binding: autonomous-katana-baton-pass.
 */
import { inngest } from "@/inngest/client";
import {
  KATANA_RECONCILE_EVENT,
  runKatanaCatalogReconcile,
} from "@/server/katana/catalog-reconcile";
import { KATANA_TENANT_CONCURRENCY } from "@/server/sre/katana-throttle";

export const katanaCatalogReconcile = inngest.createFunction(
  {
    id: "katana-catalog-reconcile",
    name: "Katana catalog reconcile (self-heal)",
    triggers: [
      { cron: "0 */2 * * *" },
      { event: KATANA_RECONCILE_EVENT },
    ],
    concurrency: [{ limit: 1 }, KATANA_TENANT_CONCURRENCY],
    // ≤ 30 Katana-facing runs / minute across the env (defense in depth vs 429).
    throttle: { limit: 30, period: "1m" },
    retries: 2,
  },
  async ({ step }) => {
    return step.run("reconcile-katana-catalog", () => runKatanaCatalogReconcile());
  },
);
