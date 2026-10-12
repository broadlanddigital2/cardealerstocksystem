"use client";

// Sign-in state for the dealer back office.
//
// The session lives in an HttpOnly cookie set by /api/auth/verify-code, so the
// browser sends it with every same-site request automatically and page code
// never sees the token. The hooks below keep the small surface the views
// already use (`useAuth().getToken`, `useUser().user`, `useSignOut`).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface Session {
  email: string;
}

interface AuthState {
  session: Session | null;
  isLoaded: boolean;
  /** Re-reads the session from the server (after signing in). */
  refresh: () => Promise<Session | null>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  isLoaded: false,
  refresh: async () => null,
});

async function fetchSession(): Promise<Session | null> {
  try {
    const res = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { signedIn?: boolean; email?: string };
    return data.signedIn && data.email ? { email: data.email } : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const s = await fetchSession();
    setSession(s);
    setLoaded(true);
    return s;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ session, isLoaded, refresh }), [session, isLoaded, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useSession(): AuthState {
  return useContext(AuthContext);
}

/**
 * `getToken()` is kept for existing callers. The session travels in a cookie,
 * so there is no token for page code to attach: it always returns null and
 * requests are authenticated by the browser automatically.
 */
export function useAuth() {
  const { session, isLoaded } = useSession();
  const getToken = useCallback(async (): Promise<string | null> => null, []);
  return { getToken, isLoaded, isSignedIn: Boolean(session), userId: session?.email ?? null };
}

export interface AppUserProfile {
  id: string;
  email: string | null;
  fullName: string | null;
  firstName: string | null;
}

export function useUser(): { user: AppUserProfile | null; isLoaded: boolean; isSignedIn: boolean } {
  const { session, isLoaded } = useSession();
  const user = useMemo<AppUserProfile | null>(
    () => (session ? { id: session.email, email: session.email, fullName: null, firstName: null } : null),
    [session],
  );
  return { user, isLoaded, isSignedIn: Boolean(session) };
}

export function useSignOut() {
  return useCallback(async (redirectTo = "/") => {
    await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin" }).catch(() => {});
    window.location.assign(redirectTo);
  }, []);
}

/** Absolute URL on this site. */
export function siteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}
