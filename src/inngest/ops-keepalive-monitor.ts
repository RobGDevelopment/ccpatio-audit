/**
 * Daily keep-alive & dead-man's-switch monitor (exception-only alerts).
 * Binding: autonomous-katana-baton-pass.
 */
import { inngest } from "@/inngest/client";
import { runOpsKeepaliveMonitor } from "@/server/ops/keepalive";

export const opsKeepaliveMonitor = inngest.createFunction(
  {
    id: "ops-keepalive-monitor",
    name: "Ops keep-alive & dead-man's switch",
    triggers: [{ cron: "0 11 * * *" }],
    concurrency: { limit: 1 },
    retries: 1,
  },
  async ({ step }) => {
    return step.run("run-ops-keepalive", () => runOpsKeepaliveMonitor());
  },
);
