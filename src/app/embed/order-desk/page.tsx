import { OrderDeskPortal } from "@/app/embed/order-desk/OrderDeskPortal";
import {
  readActorFromSearchRecord,
  readOpportunityIdFromSearchRecord,
  readQuoteIdFromSearchRecord,
} from "@/lib/embed-actor-params";
import { getPimSession } from "@/lib/pim-audit";
import { loadOrderDesk } from "@/server/quotes/load-order-desk";

export const dynamic = "force-dynamic";

/**
 * GoHighLevel custom menu:
 * /embed/order-desk?embedKey=<GHL_EMBED_SECRET>&ghlUserId={{user.id}}&ghlUserEmail={{user.email}}&opportunityId={{opportunity.id}}
 */
export default async function EmbedOrderDeskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getPimSession();
  if (!session) {
    return (
      <main className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#FAFAFA] px-6">
        <p
          role="alert"
          data-testid="order-desk-unauthorized"
          className="max-w-md rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-medium text-rose-700"
        >
          This embed link is missing a valid access key.
        </p>
      </main>
    );
  }

  const params = await searchParams;
  const actor = readActorFromSearchRecord(params);
  const model = await loadOrderDesk({
    opportunityId: readOpportunityIdFromSearchRecord(params),
    quoteId: readQuoteIdFromSearchRecord(params),
    ghlUserId: actor.ghlUserId,
    ghlUserEmail: actor.ghlUserEmail,
  });

  return (
    <div className="h-full min-h-0 flex-1 overflow-auto bg-[#FAFAFA] text-slate-900">
      <OrderDeskPortal
        initial={model}
        ghlUserId={actor.ghlUserId}
        ghlUserEmail={actor.ghlUserEmail}
      />
    </div>
  );
}
