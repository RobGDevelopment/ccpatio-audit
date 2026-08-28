"use client";

import { LogoutButton } from "../LogoutButton";
import { DictionaryTourHelpButton } from "./DictionaryTour";

export function DictionaryHeaderActions() {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <DictionaryTourHelpButton />
      <LogoutButton />
    </div>
  );
}
