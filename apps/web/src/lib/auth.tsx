"use client";

// Supabase Auth for the dealer back office.
//
// The browser keeps the session (supabase-js handles refresh); every API call
// sends the current access token as `Authorization: Bearer …`, which the server
// verifies with Supabase. The hooks below mirror the small surface the views
// already used (`useAuth().getToken`, `useUser().user`, `useSignOut`).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabaseConfig";

let browserClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!browserClient) {
    browserClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "stockbook-auth",
      },
    });
  }
  return browserClient;
}

interface AuthState {
  session: Session | null;
  isLoaded: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, isLoaded: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, isLoaded: false });

  useEffect(() => {
    const supabase = getSupabase();
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setState({ session: data.session, isLoaded: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState({ session, isLoaded: true });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useSession(): AuthState {
  return useContext(AuthContext);
}

/** `getToken()` returns a fresh access token (refreshing if needed), or null. */
export function useAuth() {
  const { session, isLoaded } = useSession();
  const getToken = useCallback(async (): Promise<string | null> => {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  }, []);
  return { getToken, isLoaded, isSignedIn: Boolean(session), userId: session?.user.id ?? null };
}

export interface AppUserProfile {
  id: string;
  email: string | null;
  fullName: string | null;
  firstName: string | null;
}

export function useUser(): { user: AppUserProfile | null; isLoaded: boolean; isSignedIn: boolean } {
  const { session, isLoaded } = useSession();
  const user = useMemo<AppUserProfile | null>(() => {
    const u = session?.user;
    if (!u) return null;
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const fullName =
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      null;
    return {
      id: u.id,
      email: u.email ?? null,
      fullName,
      firstName: fullName ? fullName.split(" ")[0] ?? null : null,
    };
  }, [session]);
  return { user, isLoaded, isSignedIn: Boolean(session) };
}

export function useSignOut() {
  return useCallback(async (redirectTo = "/") => {
    await getSupabase().auth.signOut();
    window.location.assign(redirectTo);
  }, []);
}

/** Absolute URL on this site, for auth email redirect links. */
export function siteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}
