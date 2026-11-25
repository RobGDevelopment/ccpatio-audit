import { cookies } from "next/headers";
import {
  EMBED_AUTH_COOKIE,
  EMBED_TOKEN_HEADER,
  embedAuthCookieOptions,
} from "@/lib/embed-auth";
import { EmbedSessionProvider } from "@/components/embed/EmbedSessionProvider";
import { resolveMasterCatalogEmbedAuth } from "@/server/ecommerce/master-catalog-embed-auth";
import {
  probeFailedStackLayers,
  type StackLayerPill,
} from "@/server/ecommerce/executive-stack-health";
import ExecutiveAuthGate from "./ecommerce/ExecutiveAuthGate";
import MasterCatalogClient from "./MasterCatalogClient";
import {
  getExecutiveStackHealthAction,
  listFinishAssetsForPortal,
  listFinishIntakeAction,
  type FinishAssetView,
} from "./actions";
import type { FinishIntakeView } from "@/server/ecommerce/finish-intake";

export const dynamic = "force-dynamic";

export default async function MasterCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const auth = await resolveMasterCatalogEmbedAuth(params);

  if (!auth.ok) {
    return (
      <ExecutiveAuthGate message={auth.message} setupUrl={auth.setupUrl} />
    );
  }

  // CHIPS cookie fallback for Chrome cross-origin GHL iframes.
  if (auth.embedToken && auth.embedAuthCookie) {
    try {
      const jar = await cookies();
      jar.set(EMBED_AUTH_COOKIE, auth.embedAuthCookie, embedAuthCookieOptions());
      jar.set(EMBED_TOKEN_HEADER, auth.embedToken, {
        ...embedAuthCookieOptions(),
        httpOnly: false,
      });
    } catch {
      // cookies().set may be restricted during RSC render; client mirror + proxy still apply.
    }
  }

  let initialAssets: FinishAssetView[] = [];
  let initialStackLayers: StackLayerPill[] = probeFailedStackLayers("Probing full stack…");

  let initialIntake: FinishIntakeView[] = [];

  const [finishes, stack, intake] = await Promise.all([
    listFinishAssetsForPortal().catch(() => null),
    getExecutiveStackHealthAction().catch(() => null),
    // Also runs the powder Gray/Beige/Bronze soft-patch. On failure the portal re-fetches
    // client-side and surfaces the error in Tab 1 (initialIntake stays empty).
    listFinishIntakeAction().catch(() => null),
  ]);
  if (finishes && finishes.ok) {
    initialAssets = finishes.assets;
  }
  if (intake && intake.ok) {
    initialIntake = intake.items;
  }
  if (stack && stack.ok) {
    initialStackLayers = stack.health.layers;
  } else {
    initialStackLayers = probeFailedStackLayers();
  }

  return (
    <EmbedSessionProvider embedToken={auth.embedToken}>
      <MasterCatalogClient
        initialCanAccess={auth.canAccess}
        initialCanFullCatalog={auth.canFullCatalog}
        initialAssets={initialAssets}
        initialStackLayers={initialStackLayers}
        initialIntake={initialIntake}
      />
    </EmbedSessionProvider>
  );
}
