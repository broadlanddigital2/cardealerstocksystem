"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ClerkProvider, useAuth, useSession } from "@clerk/nextjs";
import { shadcn } from "@clerk/themes";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const clerkAppearance = {
  baseTheme: shadcn,
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "hsl(222 47% 20%)",
    colorForeground: "hsl(222 47% 11%)",
    colorMutedForeground: "hsl(215 16% 47%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(214 32% 91%)",
    colorInputForeground: "hsl(222 47% 11%)",
    colorDanger: "hsl(0 84% 60%)",
    colorNeutral: "hsl(222 47% 11%)",
    fontFamily: "'Inter', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    cardBox: "bg-white w-[440px] max-w-full rounded-xl shadow-lg border border-slate-200 mx-auto",
    card: "!bg-transparent",
    footer: "!bg-transparent",
    headerTitle: "text-slate-900 font-bold",
    headerSubtitle: "text-slate-500",
  },
  layout: {
    logoPlacement: "inside" as const,
    logoLinkUrl: "/",
    logoImageUrl: "/logo.svg",
  },
};

// Clear cached queries whenever the signed-in session changes.
function ClerkQueryClientCacheInvalidator() {
  const { session } = useSession();
  const qc = useQueryClient();
  useEffect(() => {
    qc.clear();
  }, [session?.id, qc]);
  return null;
}

// Attach a fresh Clerk session token to every generated-API request, so a long
// form left open never submits with a stale session cookie.
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
    <ClerkProvider
      appearance={clerkAppearance}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/stock"
      signUpFallbackRedirectUrl="/stock"
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <ApiAuthTokenRegistrar />
        <TooltipProvider>
          <ErrorBoundary>{children}</ErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}
