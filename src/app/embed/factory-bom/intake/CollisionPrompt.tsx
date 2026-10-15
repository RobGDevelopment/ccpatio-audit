"use client";

import React from "react";
import { AlertCircle, RefreshCw, PlusCircle, Layers } from "lucide-react";

interface ClientDuplicatePromptProps {
  mode: "client";
  pieceName: string;
  suggestedVariantSku?: string;
  onDecision: (decision: "replace_model" | "add_another") => void;
}

interface CatalogCollisionPromptProps {
  mode: "catalog";
  productName: string;
  existingSku: string;
  suggestedVariantSku?: string;
  onDecision: (decision: "update_model" | "different") => void;
}

type CollisionPromptProps = ClientDuplicatePromptProps | CatalogCollisionPromptProps;

export function CollisionPrompt(props: CollisionPromptProps) {
  if (props.mode === "client") {
    return (
      <div className="p-4 bg-amber-50/80 dark:bg-amber-950/40 rounded-2xl border border-amber-200 dark:border-amber-800/60 space-y-3">
        <div className="flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-stone-900 dark:text-stone-100">
              Piece already exists in this project
            </h4>
            <p className="text-xs text-stone-600 dark:text-stone-300">
              You already added a piece named &ldquo;{props.pieceName}&rdquo; to this client project. What would you like to do?
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={() => props.onDecision("replace_model")}
            className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-800 dark:text-stone-200 hover:border-amber-500 font-medium text-xs shadow-sm transition"
          >
            <RefreshCw className="w-3.5 h-3.5 text-amber-500" />
            <span>Replace 3D model</span>
          </button>
          <button
            type="button"
            onClick={() => props.onDecision("add_another")}
            className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-medium text-xs shadow-sm transition"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>
              Add another {props.suggestedVariantSku ? `(${props.suggestedVariantSku})` : "(-V2)"}
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-amber-50/80 dark:bg-amber-950/40 rounded-2xl border border-amber-200 dark:border-amber-800/60 space-y-3">
      <div className="flex items-start space-x-3">
        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-stone-900 dark:text-stone-100">
            Catalog product already exists
          </h4>
          <p className="text-xs text-stone-600 dark:text-stone-300">
            A piece with matching collection, category, and dimensions already exists: &ldquo;{props.productName}&rdquo; ({props.existingSku}).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          onClick={() => props.onDecision("update_model")}
          className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-800 dark:text-stone-200 hover:border-amber-500 font-medium text-xs shadow-sm transition"
        >
          <RefreshCw className="w-3.5 h-3.5 text-amber-500" />
          <span>Update existing 3D model</span>
        </button>
        <button
          type="button"
          onClick={() => props.onDecision("different")}
          className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-medium text-xs shadow-sm transition"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>
            This is different {props.suggestedVariantSku ? `(${props.suggestedVariantSku})` : "(-V2)"}
          </span>
        </button>
      </div>
    </div>
  );
}
