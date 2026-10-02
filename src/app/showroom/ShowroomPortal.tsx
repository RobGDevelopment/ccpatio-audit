"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { FactoryOrdersView } from "./orders/FactoryOrdersView";
import type { ShowroomOrder, ShowroomSku } from "./orders/TriageCard";
import { canvas, eyebrow, pillActive, pillBase, pillIdle } from "./showroom-ui";
import { LiveStockView } from "./stock/LiveStockView";

type Tab = "stock" | "orders";

export function ShowroomPortal({
  email,
  orders,
  finishedGoods,
  fabrics,
}: {
  email: string;
  orders: ShowroomOrder[];
  finishedGoods: ShowroomSku[];
  fabrics: ShowroomSku[];
}) {
  const [tab, setTab] = useState<Tab>("stock");

  return (
    <main className={canvas}>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={eyebrow}>CC Patio</p>
            <h1 className="mt-2 text-3xl font-medium tracking-tight">Showroom</h1>
            <p className="mt-2 text-sm text-slate-500">{email}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={`${pillBase} ${tab === "stock" ? pillActive : pillIdle}`}
              onClick={() => setTab("stock")}
            >
              Live Stock
            </button>
            <button
              type="button"
              className={`${pillBase} ${tab === "orders" ? pillActive : pillIdle}`}
              onClick={() => setTab("orders")}
            >
              Factory Orders
            </button>
          </div>
        </header>
        <div className="mt-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.18 }}
            >
              {tab === "stock" ? (
                <LiveStockView />
              ) : (
                <FactoryOrdersView
                  orders={orders}
                  finishedGoods={finishedGoods}
                  fabrics={fabrics}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
