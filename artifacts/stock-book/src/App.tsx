import { useEffect, useState, createContext, useContext, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, SignOutButton, useUser, useSession, useAuth } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { setAuthTokenGetter } from "@workspace/api-client-react";

import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import AppLayout from "@/components/layout/AppLayout";
import Landing from "@/pages/Landing";
import Stock from "@/pages/Stock";
import AddVehicle from "@/pages/AddVehicle";
import VehicleDetail from "@/pages/VehicleDetail";
import Reports from "@/pages/Reports";
import Sellers from "@/pages/Sellers";
import FinanceCompanies from "@/pages/FinanceCompanies";
import SavedContacts from "@/pages/SavedContacts";
import Settings from "@/pages/Settings";
import Import from "@/pages/Import";
import CashSheet from "@/pages/CashSheet";
import Leads from "@/pages/Leads";
import Showroom from "@/pages/Showroom";
import ShowroomStock from "@/pages/ShowroomStock";
import ShowroomVehicle from "@/pages/ShowroomVehicle";
import ShowroomContact from "@/pages/ShowroomContact";
import { ShowroomPrivacy, ShowroomCookies } from "@/pages/ShowroomPolicies";
import { CookieBanner } from "@/components/showroom/CookieConsent";
import { isShowroomHost } from "@/lib/showroomHost";

const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

// The customer/showroom domain never loads Clerk or the dealer app, so a missing
// publishable key must not break it — only the dealer (staff) domain requires it.
if (!isShowroomHost && !clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

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
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  }
};

const queryClient = new QueryClient();

// Invalidator to clear query cache when session changes
function ClerkQueryClientCacheInvalidator() {
  const { session } = useSession();
  const qc = useQueryClient();
  useEffect(() => {
    qc.clear();
  }, [session?.id, qc]);
  return null;
}

// Attach a fresh Clerk session token to every API request. The browser's
// session cookie can go stale while a long form is open (the preview runs in an
// iframe where Clerk's background refresh timer is throttled), causing 401s on
// submit. getToken() always returns a valid token, refreshing if needed.
function ApiAuthTokenRegistrar() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);
  return null;
}

function HomeRedirect() {
  const { isSignedIn, isLoaded } = useUser();
  const [, setLocation] = useLocation();
  
  useEffect(() => {
    if (isLoaded && isSignedIn) setLocation("/stock");
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded || isSignedIn) return null;
  return <Landing />;
}

function DashboardRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/stock", { replace: true });
  }, [setLocation]);
  return null;
}

// Verifies the signed-in user is on the dealer's invite list before rendering
// the app. The backend enforces this too (every data request 403s for
// non-invited users); this gate just shows a friendly message instead of a
// broken-looking app full of errors.
const AccessContext = createContext<{ isAdmin: boolean }>({ isAdmin: false });
// eslint-disable-next-line react-refresh/only-export-components
export function useAccess() {
  return useContext(AccessContext);
}

function AccessGate({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<"checking" | "allowed" | "denied">("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${basePath}/api/access`, {
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
            <SignOutButton>
              <button className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
                Sign out
              </button>
            </SignOutButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AccessContext.Provider value={{ isAdmin }}>{children}</AccessContext.Provider>
  );
}

// Restricts a route to admins. Non-admin users are redirected to the stock book.
// The backend also enforces this (admin-only endpoints 403 for non-admins); this
// just keeps users out of the admin-only pages in the UI.
function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAccess();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isAdmin) setLocation("/stock", { replace: true });
  }, [isAdmin, setLocation]);

  if (!isAdmin) return null;
  return <>{children}</>;
}

function ProtectedRoute({ component: Component, adminOnly, ...rest }: any) {
  const { isSignedIn, isLoaded } = useUser();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      setLocation("/");
    }
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded || !isSignedIn) return null;

  const content = <Component {...rest} />;

  return (
    <AccessGate>
      <AppLayout>
        {adminOnly ? <AdminOnly>{content}</AdminOnly> : content}
      </AppLayout>
    </AccessGate>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  
  return (
    <ClerkProvider 
      publishableKey={clerkPubKey} 
      proxyUrl={clerkProxyUrl} 
      appearance={clerkAppearance} 
      signInUrl={`${basePath}/sign-in`} 
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))} 
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <ApiAuthTokenRegistrar />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?">
              <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
              </div>
            </Route>
            <Route path="/sign-up/*?">
              <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
              </div>
            </Route>
            
            <Route path="/dashboard"><DashboardRedirect /></Route>
            <Route path="/stock"><ProtectedRoute component={Stock} /></Route>
            <Route path="/vehicles/new"><ProtectedRoute component={AddVehicle} /></Route>
            <Route path="/vehicles/:id">{(params) => <ProtectedRoute component={VehicleDetail} id={params.id} />}</Route>
            <Route path="/reports"><ProtectedRoute component={Reports} adminOnly /></Route>
            <Route path="/cash-sheet"><ProtectedRoute component={CashSheet} /></Route>
            <Route path="/saved-contacts"><ProtectedRoute component={SavedContacts} /></Route>
            <Route path="/sellers"><ProtectedRoute component={Sellers} /></Route>
            <Route path="/finance-companies"><ProtectedRoute component={FinanceCompanies} /></Route>
            <Route path="/leads"><ProtectedRoute component={Leads} /></Route>
            <Route path="/import"><ProtectedRoute component={Import} /></Route>
            <Route path="/settings"><ProtectedRoute component={Settings} adminOnly /></Route>
            
            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

// The customer/showroom domain: render ONLY the public showroom, mounted at the
// site root, with no Clerk and no dealer app. Any non-showroom path resolves to
// the showroom home so the back office is never exposed here.
function ShowroomOnlyApp() {
  return (
    <WouterRouter base={basePath}>
      <Switch>
        <Route path="/" component={Showroom} />
        <Route path="/stock" component={ShowroomStock} />
        <Route path="/contact" component={ShowroomContact} />
        <Route path="/privacy" component={ShowroomPrivacy} />
        <Route path="/cookies" component={ShowroomCookies} />
        <Route path="/:id">
          {(params) =>
            /^\d+$/.test(params.id) ? <ShowroomVehicle id={params.id} /> : <Showroom />
          }
        </Route>
        <Route><Showroom /></Route>
      </Switch>
      {/* Mounted at the shell (not inside the footer) so the consent banner
          shows on every showroom route and transient loading/error state. */}
      <CookieBanner />
    </WouterRouter>
  );
}

function App() {
  if (isShowroomHost) return <ShowroomOnlyApp />;
  return (
    <WouterRouter base={basePath}>
      <Switch>
        {/* Public, customer-facing showroom — rendered OUTSIDE Clerk so it needs
            no sign-in and never loads the dealer app's authenticated context. */}
        <Route path="/showroom" component={Showroom} />
        <Route path="/showroom/contact" component={ShowroomContact} />
        <Route path="/showroom/stock" component={ShowroomStock} />
        <Route path="/showroom/privacy" component={ShowroomPrivacy} />
        <Route path="/showroom/cookies" component={ShowroomCookies} />
        <Route path="/showroom/:id">{(params) => <ShowroomVehicle id={params.id} />}</Route>
        {/* Everything else is the authenticated dealer app. */}
        <Route><ClerkProviderWithRoutes /></Route>
      </Switch>
      {/* Consent banner only on the public /showroom preview, never over the
          authenticated dealer back office. */}
      <StaffShowroomCookieBanner />
    </WouterRouter>
  );
}

// On the combined staff domain the showroom is previewed under /showroom, so the
// consent banner must only appear there — not on the authenticated dealer app.
function StaffShowroomCookieBanner() {
  const [location] = useLocation();
  return location.startsWith("/showroom") ? <CookieBanner /> : null;
}

export default App;