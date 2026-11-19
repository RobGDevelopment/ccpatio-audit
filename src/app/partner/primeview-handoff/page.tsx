import { authenticatePrimeviewHandoffToken } from "@/lib/primeview-handoff-auth";
import { generateLiveHandoffBundle } from "@/server/woocommerce/handoff-spec-generator";
import PartnerHandoffClient from "./PartnerHandoffClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function AuthGate({ status, reason }: { status: 401 | 403; reason: string }) {
  return (
    <div className="min-h-screen grid place-items-center bg-[#0f1419] text-slate-200 px-6">
      <div className="text-center max-w-md">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
          CC Patio × PrimeView
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          {status} {status === 401 ? "Unauthorized" : "Forbidden"}
        </h1>
        <p className="mt-2 text-sm text-slate-400">{reason}</p>
      </div>
    </div>
  );
}

export default async function PrimeviewHandoffPartnerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  const auth = authenticatePrimeviewHandoffToken(token);
  if (!auth.ok) {
    return <AuthGate status={auth.status} reason={auth.reason} />;
  }

  const bundle = await generateLiveHandoffBundle();

  return (
    <PartnerHandoffClient
      token={auth.token}
      generatedAtUtc={bundle.generatedAtUtc}
      generatedAtMst={bundle.generatedAtMst}
      miaApprovedCount={bundle.miaApprovedCount}
      miaLatestApprovedAt={bundle.miaLatestApprovedAt}
      sowItemCount={bundle.sowItemCount}
      parentCount={bundle.parentCount}
      uniquePurchasableSkus={bundle.uniquePurchasableSkus}
      variationCount={bundle.variationCount}
      simpleCount={bundle.simpleCount}
      webhookUrl={bundle.webhookUrl}
      storefrontRows={bundle.storefrontRows}
    />
  );
}
