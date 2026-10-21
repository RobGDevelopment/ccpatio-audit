import { OrderDeskPortal } from "@/app/embed/order-desk/OrderDeskPortal";
import {
  readActorFromSearchRecord,
  readContactIdFromSearchRecord,
  readLocationIdFromSearchRecord,
  readOpportunityIdFromSearchRecord,
  readQuoteIdFromSearchRecord,
} from "@/lib/embed-actor-params";
import { getPimSession } from "@/lib/pim-audit";
import { loadOrderDesk } from "@/server/quotes/load-order-desk";

export const dynamic = "force-dynamic";

/**
 * GoHighLevel custom menu:
 * /embed/order-desk?embedKey=<GHL_EMBED_SECRET>&ghlUserId={{user.id}}&ghlUserEmail={{user.email}}&opportunityId={{opportunity.id}}
 *
 * `opportunityId` is optional. Without it (or with `quoteId`, for a saved quote) the page opens on
 * the customer search, and picking a customer there reloads this page with that customer's
 * `opportunityId` and `contactId` in the URL. Either way `loadOrderDesk` reads the latest contact
 * and opportunity from GoHighLevel and brings an open draft in line with them before it renders.
 */
export default async function EmbedOrderDeskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getPimSession();
  if (!session) {
    return (
      <main className="flex min-h-screen flex-1 items-center justify-center bg-[#FAFAFA] px-6">
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
    contactId: readContactIdFromSearchRecord(params),
    locationId: readLocationIdFromSearchRecord(params),
    ghlUserId: actor.ghlUserId,
    ghlUserEmail: actor.ghlUserEmail,
  });

  return (
    <div className="min-h-screen w-full flex-1 overflow-x-hidden bg-[#FAFAFA] text-slate-900">
      <OrderDeskPortal
        initial={model}
        ghlUserId={actor.ghlUserId}
        ghlUserEmail={actor.ghlUserEmail}
      />
    </div>
  );
}
