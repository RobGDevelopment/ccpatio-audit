"use client";

import { ToastProvider } from "@/app/admin/shared/ToastProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
