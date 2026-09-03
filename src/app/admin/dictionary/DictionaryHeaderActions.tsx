"use client";

import { LogoutButton } from "../LogoutButton";
import { DictionaryTourHelpButton } from "./DictionaryTour";
import { StaffRequestsDropdown } from "@/app/admin/shared/StaffRequestsDropdown";

export function DictionaryHeaderActions() {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <StaffRequestsDropdown />
      <div className="h-6 w-px bg-zinc-800"></div>
      <DictionaryTourHelpButton />
      <LogoutButton />
    </div>
  );
}
