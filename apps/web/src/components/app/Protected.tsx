"use client";

import { useEffect, type ReactNode } from "react";
import { useUser } from "@/lib/auth";
import AppLayout from "@/components/layout/AppLayout";
import { useLocation } from "@/lib/router";
import { AccessGate, AdminOnly, ModuleOnly } from "./access";
import type { ModuleKey } from "@/lib/modules";

// Signed-in + invited (+ optionally admin) wrapper for every back-office page.
export function Protected({
  children,
  adminOnly,
  modules,
}: {
  children: ReactNode;
  adminOnly?: boolean;
  /** Page needs at least one of these modules. */
  modules?: ModuleKey[];
}) {
  const { isSignedIn, isLoaded } = useUser();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoaded && !isSignedIn) setLocation("/sign-in");
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded || !isSignedIn) return null;

  return (
    <AccessGate>
      <AppLayout>
        {adminOnly ? (
          <AdminOnly>{children}</AdminOnly>
        ) : modules ? (
          <ModuleOnly modules={modules}>{children}</ModuleOnly>
        ) : (
          children
        )}
      </AppLayout>
    </AccessGate>
  );
}
