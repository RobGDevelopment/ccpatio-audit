import { getPimSession } from "@/lib/pim-audit";
import {
  getLogisticsProfiles,
  getLogisticsSettings,
} from "@/server/actions/logistics";
import { LogisticsDashboard } from "./LogisticsDashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function LogisticsPage() {
  const session = await getPimSession();
  const [rows, settings] = await Promise.all([
    getLogisticsProfiles(),
    getLogisticsSettings(),
  ]);

  return (
    <main className="pim-carbon-shell min-h-screen text-zinc-50">
      <LogisticsDashboard
        rows={rows}
        settings={settings}
        operatorEmail={session?.email ?? null}
      />
    </main>
  );
}
