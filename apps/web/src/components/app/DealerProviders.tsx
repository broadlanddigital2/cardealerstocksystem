"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/lib/auth";

// Clear cached queries whenever the signed-in user changes.
function QueryCacheResetOnUserChange() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    qc.clear();
  }, [userId, qc]);
  return null;
}

// Generated-API requests are authenticated by the session cookie; getToken()
// returns null, so no Authorization header is added.
function ApiAuthTokenRegistrar() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);
  return null;
}

export function DealerProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <QueryCacheResetOnUserChange />
        <ApiAuthTokenRegistrar />
        <TooltipProvider>
          <ErrorBoundary>{children}</ErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}
