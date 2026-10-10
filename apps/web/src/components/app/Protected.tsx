"use client";

import { useEffect, type ReactNode } from "react";
import { useUser } from "@clerk/nextjs";
import AppLayout from "@/components/layout/AppLayout";
import { useLocation } from "@/lib/router";
import { AccessGate, AdminOnly } from "./access";

// Signed-in + invited (+ optionally admin) wrapper for every back-office page.
export function Protected({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  const { isSignedIn, isLoaded } = useUser();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoaded && !isSignedIn) setLocation("/");
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded || !isSignedIn) return null;

  return (
    <AccessGate>
      <AppLayout>{adminOnly ? <AdminOnly>{children}</AdminOnly> : children}</AppLayout>
    </AccessGate>
  );
}
