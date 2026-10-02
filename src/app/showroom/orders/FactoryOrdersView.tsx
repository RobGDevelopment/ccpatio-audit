"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { eyebrow } from "../showroom-ui";
import { TriageCard, type ShowroomOrder, type ShowroomSku } from "./TriageCard";

export function FactoryOrdersView({
  orders,
  finishedGoods,
  fabrics,
}: {
  orders: ShowroomOrder[];
  finishedGoods: ShowroomSku[];
  fabrics: ShowroomSku[];
}) {
  const [queue, setQueue] = useState(orders);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section className="space-y-6">
      <div>
        <p className={eyebrow}>Factory orders</p>
        <p className="mt-2 text-sm text-slate-500">
          {queue.length === 0 ? "The queue is clear." : `${queue.length} waiting`}
        </p>
        {notice ? <p className="mt-3 text-sm text-slate-700">{notice}</p> : null}
      </div>
      <div className="space-y-4">
        <AnimatePresence>
          {queue.map((order) => (
            <motion.div
              key={order.id}
              layout
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 48 }}
              transition={{ duration: 0.18 }}
            >
              <TriageCard
                order={order}
                finishedGoods={finishedGoods}
                fabrics={fabrics}
                onNotice={setNotice}
                onDone={(id) => setQueue((current) => current.filter((row) => row.id !== id))}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
