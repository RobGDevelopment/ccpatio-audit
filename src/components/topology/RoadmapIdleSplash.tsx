"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const BREATH_PHRASES = [
  "Watch a patio order travel from first hello to the driveway",
  "See every handoff — showroom, design, factory, delivery",
  "Four living paths: Scottsdale, Solana Beach, Trade, and Warranty",
  "Follow the work as it moves through the business",
  "Open Roadmap Selector, then press Play",
];

export function RoadmapIdleSplash() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % BREATH_PHRASES.length);
    }, 4200);
    return () => window.clearInterval(id);
  }, []);

  const openSelector = () => {
    const btn = document.querySelector<HTMLButtonElement>(
      "[data-roadmap-selector]"
    );
    btn?.click();
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute left-1/2 top-[42%] h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(34,211,238,0.16) 0%, rgba(139,92,246,0.08) 42%, transparent 70%)",
          }}
          animate={{ opacity: [0.45, 0.85, 0.45], scale: [0.92, 1.08, 0.92] }}
          transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute left-1/2 top-[42%] h-[18rem] w-[18rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/20"
          animate={{ opacity: [0.15, 0.55, 0.15], scale: [1, 1.18, 1] }}
          transition={{ duration: 5.2, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="relative mx-6 max-w-2xl text-center">
        <motion.p
          className="mb-4 text-[10px] font-semibold uppercase tracking-[0.42em] text-cyan-400/80"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          Operations Command Center
        </motion.p>

        <motion.h1
          className="font-[family-name:var(--font-display)] text-[clamp(2.1rem,5.5vw,3.6rem)] font-medium leading-[1.12] tracking-tight text-slate-50"
          style={{
            textShadow:
              "0 0 28px rgba(34,211,238,0.28), 0 0 64px rgba(167,139,250,0.18)",
          }}
          animate={{ opacity: [0.72, 1, 0.72], scale: [0.985, 1.015, 0.985] }}
          transition={{ duration: 5.8, repeat: Infinity, ease: "easeInOut" }}
        >
          A living map of every patio we build
        </motion.h1>

        <motion.p
          className="mt-5 font-[family-name:var(--font-display)] text-[clamp(1.2rem,2.6vw,1.65rem)] text-cyan-100/90"
          animate={{ opacity: [0.55, 1, 0.55] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
        >
          Select a roadmap to begin
        </motion.p>

        <div className="relative mx-auto mt-5 h-[3.25rem] max-w-xl">
          <AnimatePresence mode="wait">
            <motion.p
              key={index}
              className="absolute inset-0 text-[clamp(1.05rem,2.4vw,1.45rem)] leading-snug text-slate-300"
              initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -10, filter: "blur(8px)" }}
              transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
            >
              {BREATH_PHRASES[index]}
            </motion.p>
          </AnimatePresence>
        </div>

        <motion.button
          type="button"
          onClick={openSelector}
          className="pointer-events-auto mt-10 rounded-full border border-violet-400/50 bg-violet-500/15 px-6 py-2.5 text-[12px] font-semibold tracking-[0.18em] text-violet-100 uppercase hover:bg-violet-500/28"
          animate={{
            boxShadow: [
              "0 0 12px rgba(167,139,250,0.15)",
              "0 0 28px rgba(167,139,250,0.45)",
              "0 0 12px rgba(167,139,250,0.15)",
            ],
          }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
        >
          Open Roadmap Selector
        </motion.button>
      </div>
    </div>
  );
}
