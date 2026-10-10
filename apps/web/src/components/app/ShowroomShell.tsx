"use client";

import type { ReactNode } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import dynamic from "next/dynamic";

const CookieBanner = dynamic(
  () => import("@/components/showroom/CookieConsent").then((m) => m.CookieBanner),
  { ssr: false },
);

export function ShowroomShell({ children }: { children: ReactNode }) {
  return (
    <>
      <ErrorBoundary>{children}</ErrorBoundary>
      {/* Mounted at the shell so the consent banner shows on every showroom route. */}
      <CookieBanner />
    </>
  );
}
