"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth, useSignOut } from "@/lib/auth";
import { useLocation } from "@/lib/router";

// Verifies the signed-in user is on the dealer's invite list before rendering
// the app. The backend enforces this too (every data request 403s for
// non-invited users); this gate just shows a friendly message instead of a
// broken-looking app full of errors.
const AccessContext = createContext<{ isAdmin: boolean }>({ isAdmin: false });

export function useAccess() {
  return useContext(AccessContext);
}

export function AccessGate({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const signOut = useSignOut();
  const [status, setStatus] = useState<"checking" | "allowed" | "denied">("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`/api/access`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const data = await res.json();
        if (cancelled) return;
        setEmail(data?.email ?? null);
        setIsAdmin(Boolean(data?.isAdmin));
        setStatus(data?.allowed ? "allowed" : "denied");
      } catch {
        if (!cancelled) setStatus("denied");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  if (status === "checking") return null;

  if (status === "denied") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white w-[440px] max-w-full rounded-xl shadow-lg border border-slate-200 p-8 text-center">
          <h1 className="text-xl font-bold text-slate-900">Access not enabled</h1>
          <p className="mt-3 text-sm text-slate-500">
            You're signed in{email ? ` as ${email}` : ""}, but this account hasn't been
            invited to the stock book yet.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Ask the dealer to add your email address, then sign in again.
          </p>
          <div className="mt-6">
            <button
              onClick={() => signOut("/")}
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <AccessContext.Provider value={{ isAdmin }}>{children}</AccessContext.Provider>;
}

// Restricts a route to admins. Non-admin users are redirected to the stock book.
// The backend also enforces this (admin-only endpoints 403 for non-admins).
export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAccess();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isAdmin) setLocation("/stock", { replace: true });
  }, [isAdmin, setLocation]);

  if (!isAdmin) return null;
  return <>{children}</>;
}
