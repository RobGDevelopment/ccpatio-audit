"use client";

import { useCallback, useEffect, useRef } from "react";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";

export const DICTIONARY_TOUR_STORAGE_KEY = "hasSeenDictionaryTour";

function createTourDriver(onFinished: () => void): Driver {
  return driver({
    showProgress: true,
    animate: true,
    allowClose: true,
    overlayColor: "#020617",
    overlayOpacity: 0.78,
    stagePadding: 10,
    stageRadius: 10,
    smoothScroll: true,
    skipMissingElement: true,
    popoverClass: "dictionary-tour-popover",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Got it",
    steps: [
      {
        element: "#dictionary-tour-mission",
        popover: {
          title: "The mission",
          description:
            "Welcome to the Data Sprint. Your goal is to clear out the missing data.",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: '[data-tour="dictionary-category-tabs"]',
        popover: {
          title: "Category filters",
          description:
            "Click these tabs to filter the list. You can select multiple at once, or click the 'X' to remove a filter.",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: '[data-tour="dictionary-data-health"]',
        popover: {
          title: "Data entry",
          description:
            "Cells outlined in red are missing critical data. Click, type your value, and click away. It auto-saves instantly.",
          side: "left",
          align: "start",
        },
      },
      {
        element: '[data-tour="dictionary-web-column"]',
        popover: {
          title: "E-Commerce sync",
          description:
            "Only check this box if the item should be visible and sold on the WooCommerce retail site.",
          side: "left",
          align: "start",
        },
      },
    ],
    onDestroyed: onFinished,
  });
}

export function startDictionaryTour(options?: { markSeen?: boolean }): void {
  const markSeen = options?.markSeen ?? false;
  const tour = createTourDriver(() => {
    if (markSeen) {
      localStorage.setItem(DICTIONARY_TOUR_STORAGE_KEY, "true");
    }
  });
  tour.drive();
}

/** Auto-starts the tour on first visit only. */
export function DictionaryTour() {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (localStorage.getItem(DICTIONARY_TOUR_STORAGE_KEY)) return;

    startedRef.current = true;
    const timer = window.setTimeout(() => {
      startDictionaryTour({ markSeen: true });
    }, 700);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}

export function DictionaryTourHelpButton() {
  const handleRestart = useCallback(() => {
    startDictionaryTour();
  }, []);

  return (
    <button
      type="button"
      onClick={handleRestart}
      className="rounded-md border border-slate-700/60 px-3 py-1.5 text-xs text-slate-400 transition hover:border-emerald-500/30 hover:text-emerald-300"
    >
      Restart tutorial
    </button>
  );
}
