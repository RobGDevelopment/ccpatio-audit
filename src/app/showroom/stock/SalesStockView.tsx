"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { readActorFromHref } from "@/lib/embed-actor-params";
import {
  getShowroomFeatureFlags,
  type ShowroomFeatureFlags,
} from "@/lib/showroom-feature-flags";
import { useEmbedSession } from "@/components/embed/EmbedSessionProvider";
import {
  IN_STOCK_DEFAULT_TABS,
  SHOWROOM_DEFAULT_SALES_TAB,
  SHOWROOM_SALES_TAB_LABELS,
  orderDeskMtoHref,
  visibleShowroomSalesTabs,
  type SalesStockCard,
  type ShowroomSalesTab,
} from "@/server/showroom/sales-projection";
import {
  resolveHubSyncBadge,
  type HubSyncBadge,
  type HubSyncBadgeTone,
} from "@/server/stock/hub-sync-freshness";
import {
  listActiveShowroomHolds,
  loadShowroomSalesInventoryAction,
  resolveShowroomHoldActor,
  type ActiveShowroomHold,
} from "../actions";
import { eyebrow, softField } from "../showroom-ui";
import { InventoryCard } from "./InventoryCard";
import type { ViewMode } from "./ViewModeToggle";
import { ViewModeToggle } from "./ViewModeToggle";
const softControl =
  "border border-slate-100 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]";
const tactileIdle = "border-b-2 border-slate-200 bg-white text-slate-600";
const tactileActive = "translate-y-0.5 bg-slate-50 text-slate-900 shadow-inner";

const BADGE_TONE_CLASS: Record<HubSyncBadgeTone, string> = {
  green: "bg-emerald-50 text-emerald-800",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-rose-50 text-rose-800",
};

function GoldBeam() {
  return (
    <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden" aria-hidden="true">
      <span className="animate-beam-glide-lux absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[#C5A059] to-transparent" />
    </span>
  );
}

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function SalesStockView({
  initialCards,
  initialSyncedAt,
  initialTab = SHOWROOM_DEFAULT_SALES_TAB,
  featureFlags: featureFlagsProp,
  ghlUserId,
  ghlUserEmail,
}: {
  initialCards?: SalesStockCard[];
  initialSyncedAt?: string | null;
  initialTab?: ShowroomSalesTab;
  featureFlags?: ShowroomFeatureFlags;
  ghlUserId?: string;
  ghlUserEmail?: string;
} = {}) {
  const { embedToken, embedFetch } = useEmbedSession();
  const flags = featureFlagsProp ?? getShowroomFeatureFlags();
  const visibleTabs = useMemo(
    () => visibleShowroomSalesTabs(flags.enableMtoCatalog),
    [flags.enableMtoCatalog],
  );
  const [tab, setTab] = useState<ShowroomSalesTab>(initialTab);
  const [query, setQuery] = useState("");
  const [inStockOnly, setInStockOnly] = useState(true);
  const [cards, setCards] = useState<SalesStockCard[]>(initialCards ?? []);
  const [message, setMessage] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(initialSyncedAt ?? null);
  const [badge, setBadge] = useState<HubSyncBadge>(() => resolveHubSyncBadge(initialSyncedAt ?? null));
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [salesperson, setSalesperson] = useState<string | null>(null);
  const [holdActorError, setHoldActorError] = useState<string | null>(null);
  const [actorUserId, setActorUserId] = useState(ghlUserId);
  const [actorUserEmail, setActorUserEmail] = useState(ghlUserEmail);
  const [holds, setHolds] = useState<ActiveShowroomHold[]>([]);
  const [activeHoldCount, setActiveHoldCount] = useState(0);
  const [pending, startTransition] = useTransition();
  const request = useRef(0);
  const hydrated = useRef(false);

  useEffect(() => {
    setInStockOnly(IN_STOCK_DEFAULT_TABS.has(tab));
  }, [tab]);

  useEffect(() => {
    if (!flags.enableMtoCatalog && tab === "mto_catalog") {
      setTab(SHOWROOM_DEFAULT_SALES_TAB);
    }
  }, [flags.enableMtoCatalog, tab]);

  const reload = useCallback(
    async (nextTab: ShowroomSalesTab = tab, nextInStock = inStockOnly, nextQuery = query) => {
      const id = ++request.current;
      setErrorBanner(null);
      try {
        const result = await loadShowroomSalesInventoryAction({
          embedToken,
          tab: nextTab,
          inStockOnly: nextTab === "mto_catalog" || nextTab === "active_holds" ? false : nextInStock,
          query: nextQuery,
        });
        if (id !== request.current) return;
        if (!result.ok) {
          setErrorBanner(result.error);
          setMessage(result.error);
          return;
        }
        setCards(result.cards);
        setSyncedAt(result.syncedAt);
        setBadge(result.badge ?? resolveHubSyncBadge(result.syncedAt));
        setMessage(
          result.cards.length === 0
            ? nextTab === "active_holds"
              ? "No active customer holds."
              : nextTab === "floor_ready"
                ? null
                : "Nothing matches this sales tab."
            : result.warning,
        );
        // Never surface raw rate-limit developer strings; badge status carries staleness.
        setErrorBanner(null);
      } catch (error: unknown) {
        if (id !== request.current) return;
        const msg = error instanceof Error ? error.message : "Could not load sales inventory.";
        setErrorBanner(msg);
        setMessage(msg);
      }
    },
    [embedToken, tab, inStockOnly, query],
  );

  const queueBackgroundRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await embedFetch("/api/katana/showroom-inventory", { method: "POST" });
      await reload(tab, inStockOnly, query);
    } catch {
      // Hub reload still available; badge already shows stale state.
    } finally {
      setRefreshing(false);
    }
  }, [embedFetch, reload, tab, inStockOnly, query]);

  const refreshActiveHoldCount = useCallback(async () => {
    try {
      const result = await loadShowroomSalesInventoryAction({
        embedToken,
        tab: "active_holds",
        inStockOnly: false,
      });
      if (result.ok) {
        setActiveHoldCount(result.cards.reduce((sum, c) => sum + (c.heldQty > 0 ? 1 : 0), 0));
      }
    } catch {
      // Badge is informational; keep last known count.
    }
  }, [embedToken]);

  useEffect(() => {
    let active = true;
    const fromUrl = readActorFromHref(window.location.href);
    const userId = ghlUserId?.trim() || fromUrl.ghlUserId;
    const email = ghlUserEmail?.trim() || fromUrl.ghlUserEmail;
    setActorUserId(userId);
    setActorUserEmail(email);
    setSalesperson(null);
    setHoldActorError(null);
    void resolveShowroomHoldActor({
      ghlUserId: userId,
      ghlUserEmail: email,
      embedToken,
    }).then((result) => {
      if (!active) return;
      if (result.ok) setSalesperson(result.name);
      else setHoldActorError(result.error);
    });
    return () => {
      active = false;
    };
  }, [ghlUserId, ghlUserEmail, embedToken]);

  useEffect(() => {
    void refreshActiveHoldCount();
  }, [refreshActiveHoldCount]);

  useEffect(() => {
    if (!hydrated.current && initialCards && initialCards.length > 0 && tab === initialTab) {
      hydrated.current = true;
      return;
    }
    hydrated.current = true;
    startTransition(() => {
      void reload(tab, inStockOnly, query);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional tab/filter driven reload
  }, [tab, inStockOnly]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!hydrated.current) return;
      startTransition(() => {
        void reload(tab, inStockOnly, query);
      });
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    const ids = [...new Set(cards.map((c) => c.variantId))].filter((id) => id > 0);
    if (ids.length === 0) {
      setHolds([]);
      return;
    }
    let active = true;
    void listActiveShowroomHolds(ids, embedToken).then((result) => {
      if (!active) return;
      setHolds(result.ok ? result.holds : []);
    });
    return () => {
      active = false;
    };
  }, [cards, embedToken]);

  const visible = useMemo(() => cards, [cards]);

  const mtoHref = useMemo(
    () =>
      orderDeskMtoHref({
        href: typeof window !== "undefined" ? window.location.href : undefined,
        embedToken,
        ghlUserId: actorUserId,
        ghlUserEmail: actorUserEmail,
      }),
    [embedToken, actorUserId, actorUserEmail],
  );

  const showOrderDeskCta = flags.enableOrderDeskCta && flags.enableMtoCatalog;

  function tabLabel(key: ShowroomSalesTab): string {
    if (key === "active_holds") {
      return activeHoldCount > 0
        ? `${SHOWROOM_SALES_TAB_LABELS[key]} (${activeHoldCount})`
        : SHOWROOM_SALES_TAB_LABELS[key];
    }
    return SHOWROOM_SALES_TAB_LABELS[key];
  }

  return (
    <section className="rounded-3xl bg-[#F8F9FA]" data-inventory-mode="sales" data-testid="sales-stock-view">
      <div className="sticky top-0 z-30 space-y-4 border-b border-slate-100 bg-[#F8F9FA]/90 px-6 py-4 backdrop-blur-md sm:px-8">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={eyebrow}>Showroom Sales · Live Stock</p>
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="hub-synced-badge"
                data-tone={badge.tone}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold ${BADGE_TONE_CLASS[badge.tone]}`}
              >
                {badge.tone === "green"
                  ? `Hub synced: ${formatSyncedAt(syncedAt)}`
                  : badge.statusLabel}
              </span>
              {badge.tone !== "green" && syncedAt ? (
                <span className="text-[10px] text-slate-500">{formatSyncedAt(syncedAt)}</span>
              ) : null}
              {badge.showRefreshButton ? (
                <button
                  type="button"
                  data-testid="hub-sync-refresh"
                  disabled={refreshing}
                  onClick={() => void queueBackgroundRefresh()}
                  className={`${softControl} rounded-full px-3 py-1 text-[11px] font-semibold text-slate-800`}
                >
                  {refreshing ? "Syncing…" : "Refresh"}
                </button>
              ) : null}
              {pending ? (
                <span className="text-[11px] text-slate-500">Updating…</span>
              ) : null}
            </div>
          </div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or SKU"
              className={`${softField} pl-9`}
              aria-label="Search sales stock"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {IN_STOCK_DEFAULT_TABS.has(tab) ? (
              <button
                type="button"
                role="switch"
                aria-checked={inStockOnly}
                onClick={() => setInStockOnly((current) => !current)}
                className={`${softControl} inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs text-slate-700`}
              >
                <span
                  className={`relative h-5 w-9 rounded-full transition-colors duration-300 ${
                    inStockOnly ? "bg-slate-900" : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-300 ${
                      inStockOnly ? "left-4" : "left-0.5"
                    }`}
                  />
                </span>
                In stock only
              </button>
            ) : null}
            <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
          </div>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Sales category">
            {visibleTabs.map((key) => {
              const selected = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`sales-tab-${key}`}
                  className={`relative shrink-0 overflow-hidden rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    selected ? tactileActive : tactileIdle
                  }`}
                  onClick={() => setTab(key)}
                >
                  {selected ? <GoldBeam /> : null}
                  {tabLabel(key)}
                </button>
              );
            })}
          </div>
          {tab === "mto_catalog" && showOrderDeskCta ? (
            <a
              href={mtoHref}
              data-testid="quote-mto-order-desk"
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition hover:bg-slate-800"
            >
              Quote Make-to-Order in Order Desk
            </a>
          ) : null}
        </div>
        {errorBanner ? (
          <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {errorBanner}
          </p>
        ) : null}
        {message && !errorBanner ? (
          <p className="text-xs text-slate-500">{message}</p>
        ) : null}
        {holdActorError ? (
          <p className="text-xs text-amber-800">{holdActorError}</p>
        ) : null}
      </div>

      <div className="px-6 py-6 sm:px-8">
        <LayoutGroup>
          <AnimatePresence mode="popLayout">
            {visible.length === 0 ? (
              tab === "floor_ready" ? (
                <motion.article
                  key="floor-empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  data-testid="floor-ready-empty"
                  className="rounded-2xl border border-slate-100 bg-white px-6 py-10 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
                >
                  <p className="text-sm font-medium text-slate-800">
                    No pre-built floor models currently in stock.
                  </p>
                </motion.article>
              ) : (
                <motion.p
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm text-slate-500"
                >
                  {message ?? "No items."}
                </motion.p>
              )
            ) : (
              <motion.div
                layout
                className={
                  viewMode === "dropdown"
                    ? "space-y-3"
                    : "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                }
              >
                {visible.map((card) => {
                  const rowHolds = holds.filter((h) => h.variantId === card.variantId);
                  return (
                    <InventoryCard
                      key={card.variantId}
                      row={card}
                      warehouses={card.warehouses}
                      holdBadges={card.holdBadges}
                      heldQty={card.heldQty}
                      canHold={Boolean(salesperson) && !holdActorError}
                      holdDisabledReason={holdActorError}
                      salesperson={salesperson}
                      ghlUserId={actorUserId}
                      ghlUserEmail={actorUserEmail}
                      holds={rowHolds}
                      showMtoQuote={tab === "mto_catalog" && showOrderDeskCta}
                      mtoHref={
                        showOrderDeskCta
                          ? orderDeskMtoHref({
                              href: typeof window !== "undefined" ? window.location.href : undefined,
                              embedToken,
                              ghlUserId: actorUserId,
                              ghlUserEmail: actorUserEmail,
                              sku: card.sku,
                            })
                          : undefined
                      }
                      onHoldPlaced={() => {
                        startTransition(() => {
                          void reload();
                          void refreshActiveHoldCount();
                        });
                      }}
                      onOptimisticRelease={(holdId) => {
                        setHolds((current) => current.filter((h) => h.id !== holdId));
                      }}
                      onReleaseFailed={() => {
                        startTransition(() => {
                          void reload();
                        });
                      }}
                      onHoldReleased={() => {
                        startTransition(() => {
                          void reload();
                          void refreshActiveHoldCount();
                        });
                      }}
                      onHoldExtended={(holdId, expiresAt) => {
                        setHolds((current) =>
                          current.map((h) => (h.id === holdId ? { ...h, expiresAt } : h)),
                        );
                      }}
                    />
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>
      </div>
    </section>
  );
}
