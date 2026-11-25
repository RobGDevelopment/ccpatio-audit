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
  type FinishAssetView,
} from "./actions";

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

  const [finishes, stack] = await Promise.all([
    listFinishAssetsForPortal().catch(() => null),
    getExecutiveStackHealthAction().catch(() => null),
  ]);
  if (finishes && finishes.ok) {
    initialAssets = finishes.assets;
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
      />
    </EmbedSessionProvider>
  );
}
