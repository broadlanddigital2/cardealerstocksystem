"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth, useSignOut } from "@/lib/auth";
import { useLocation } from "@/lib/router";
import { cleanModuleList, type ModuleKey } from "@/lib/modules";

// Verifies the signed-in user is on the dealer's invite list before rendering
// the app. The backend enforces this too (every data request 403s for
// non-invited users); this gate just shows a friendly message instead of a
// broken-looking app full of errors.
interface Access {
  /** False outside the signed-in app (e.g. tests, public pages). */
  loaded: boolean;
  isAdmin: boolean;
  /** Modules this user can use (site modules, limited by their role). */
  modules: ModuleKey[];
  /** Modules this dealer has (what an admin can hand out to Staff). */
  siteModules: ModuleKey[];
  has: (key: ModuleKey) => boolean;
}

const AccessContext = createContext<Access>({
  loaded: false,
  isAdmin: false,
  modules: [],
  siteModules: [],
  has: () => false,
});

export function useAccess() {
  return useContext(AccessContext);
}

export function AccessGate({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const signOut = useSignOut();
  const [status, setStatus] = useState<"checking" | "allowed" | "denied">("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [modules, setModules] = useState<ModuleKey[]>([]);
  const [siteModules, setSiteModules] = useState<ModuleKey[]>([]);

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
        setModules(cleanModuleList(data?.modules));
        setSiteModules(cleanModuleList(data?.siteModules));
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

  const value: Access = {
    loaded: true,
    isAdmin,
    modules,
    siteModules,
    has: (key) => modules.includes(key),
  };
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
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

// Restricts a page to users who can use at least one of the given modules.
// The backend enforces the same rule on the matching API endpoints.
export function ModuleOnly({ modules, children }: { modules: ModuleKey[]; children: ReactNode }) {
  const { has } = useAccess();
  const allowed = modules.some((m) => has(m));
  if (allowed) return <>{children}</>;
  return (
    <div className="max-w-xl mx-auto mt-16 text-center">
      <h1 className="text-xl font-bold text-slate-900">Not available</h1>
      <p className="mt-2 text-sm text-slate-500">
        This part of the stock book isn't switched on for you. If you think you need it, ask your admin.
      </p>
    </div>
  );
}
