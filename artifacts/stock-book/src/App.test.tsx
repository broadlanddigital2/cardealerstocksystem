import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// A minimal but valid /api/showroom payload so the showroom renders its full
// home page (header, hero, footer) instead of the loading/error fallback.
const showroomPayload = {
  dealer: {
    businessName: "Manor Garage Car Sales Ltd",
    address: "1 High Street",
    phone: "01234 567890",
    email: "sales@manorgarage.co.uk",
    website: "https://manorgarage.co.uk",
    logoPath: null,
    businessType: null,
    companyName: null,
    companyNumber: null,
    placeOfRegistration: null,
    showroomEnabled: true,
    showroomHeadline: "Quality used cars",
    showroomReviews: null,
  },
  vehicles: [],
};

function showroomFetchMock() {
  return vi.fn(async () =>
    new Response(JSON.stringify(showroomPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// Set the customer (showroom) host + env BEFORE importing App, because both
// App.tsx and showroomHost.ts read VITE_SHOWROOM_HOSTS / window.location.hostname
// at module-evaluation time.
function setHost(hostname: string) {
  Object.defineProperty(window, "location", {
    value: { ...window.location, hostname, origin: `https://${hostname}` },
    writable: true,
    configurable: true,
  });
}

async function loadApp(opts: { hosts?: string; hostname: string }) {
  vi.stubEnv("VITE_SHOWROOM_HOSTS", opts.hosts ?? "");
  // BASE_URL is read by App.tsx; keep it root so wouter paths are simple.
  vi.stubEnv("BASE_URL", "/");
  setHost(opts.hostname);
  vi.resetModules();
  const mod = await import("./App");
  return mod.default;
}

describe("App routing by host", () => {
  beforeEach(() => {
    vi.resetModules();
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("on a customer host, mounts ONLY the showroom (no Clerk / no back office)", async () => {
    // Stub fetch so the showroom's data load doesn't hit the network.
    vi.stubGlobal("fetch", showroomFetchMock());

    const App = await loadApp({
      hosts: "manorgarage.co.uk",
      hostname: "manorgarage.co.uk",
    });

    const { container } = render(<App />);

    // Wait for the showroom to load its data and render the home page.
    await screen.findByText("Quality used cars");

    // The showroom home renders without any sign-in UI. Clerk's <SignIn> would
    // expose its own DOM; assert none of the auth/back-office surface is present.
    expect(container.querySelector(".cl-rootBox")).toBeNull();
    expect(container.querySelector(".cl-signIn-root")).toBeNull();
    expect(screen.queryByText(/access not enabled/i)).toBeNull();

    // The showroom mounts at the root and shows customer-facing content.
    expect(screen.getByText("Manor Garage Car Sales Ltd")).toBeTruthy();
  });

  it("on a customer host, showroom internal links resolve to root-based paths", async () => {
    vi.stubGlobal("fetch", showroomFetchMock());

    const App = await loadApp({
      hosts: "manorgarage.co.uk",
      hostname: "manorgarage.co.uk",
    });

    const { container } = render(<App />);

    await screen.findByText("Quality used cars");

    // Internal showroom navigation uses showroomHref(); on the customer host
    // those are root-based (no /showroom prefix). No staff-prefixed link leaks.
    const links = Array.from(container.querySelectorAll("a[href]")).map(
      (a) => a.getAttribute("href") ?? "",
    );
    const internal = links.filter((h) => h.startsWith("/"));
    expect(internal.length).toBeGreaterThan(0);
    expect(internal.every((h) => !h.startsWith("/showroom"))).toBe(true);
    // And at least one resolves to a known root-based showroom path.
    expect(internal).toContain("/stock");
  });
});

// The complement of the customer-host suite: on a staff/combined host the dealer
// back office must mount at the root behind Clerk, AND the public showroom must
// still be reachable under /showroom. We stub @clerk/react so the Clerk-protected
// branch can mount in jsdom without booting real Clerk (the showroom routes sit
// OUTSIDE Clerk, so the stub never renders for them — its presence/absence is
// exactly the "is this the dealer app?" signal we assert on).
function mockClerk() {
  vi.doMock("@clerk/react/internal", () => ({
    // Make clerkPubKey truthy so App.tsx doesn't throw the missing-key guard.
    publishableKeyFromHost: () => "pk_test_fake",
  }));
  vi.doMock("@clerk/react", () => ({
    ClerkProvider: ({ children }: { children: ReactNode }) => (
      <div data-testid="clerk-provider">{children}</div>
    ),
    SignIn: () => <div data-testid="clerk-signin" />,
    SignUp: () => <div data-testid="clerk-signup" />,
    SignOutButton: ({ children }: { children: ReactNode }) => <>{children}</>,
    useUser: () => ({ isSignedIn: false, isLoaded: true }),
    useSession: () => ({ session: null }),
    useAuth: () => ({ getToken: async () => null }),
  }));
}

// Define a complete window.location (hostname + pathname). Unlike setHost above,
// this sets pathname explicitly: the real Location keeps pathname on its
// prototype, so a `{...window.location}` spread drops it and wouter would fall
// back to "/". Staff-host showroom routes live under /showroom, so the path must
// be set precisely.
function setStaffWindow(hostname: string, pathname: string) {
  const origin = `https://${hostname}`;
  Object.defineProperty(window, "location", {
    value: {
      hostname,
      host: hostname,
      origin,
      protocol: "https:",
      pathname,
      search: "",
      hash: "",
      href: `${origin}${pathname}`,
    },
    writable: true,
    configurable: true,
  });
}

async function loadStaffApp(opts: {
  hosts?: string;
  hostname: string;
  pathname?: string;
}) {
  vi.resetModules();
  mockClerk();
  vi.stubEnv("VITE_SHOWROOM_HOSTS", opts.hosts ?? "");
  vi.stubEnv("BASE_URL", "/");
  setStaffWindow(opts.hostname, opts.pathname ?? "/");
  const mod = await import("./App");
  return mod.default;
}

describe("App routing on a staff (combined) host", () => {
  beforeEach(() => {
    vi.resetModules();
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.doUnmock("@clerk/react");
    vi.doUnmock("@clerk/react/internal");
  });

  it("mounts the dealer app at the root behind Clerk (not the showroom)", async () => {
    // VITE_SHOWROOM_HOSTS is set to a DIFFERENT host than the current one, so
    // this is treated as a staff/combined domain.
    const App = await loadStaffApp({
      hosts: "manorgarage.co.uk",
      hostname: "stockbook.example.com",
    });

    render(<App />);

    // The combined app wraps the root routes in <ClerkProvider>; the showroom-
    // only app never does. Seeing our Clerk stub proves the dealer (staff) app
    // mounted at the root.
    expect(await screen.findByTestId("clerk-provider")).toBeTruthy();
    // The public showroom must NOT be served at the root on a staff host.
    expect(screen.queryByText("Quality used cars")).toBeNull();
  });

  it("still serves the public showroom under /showroom, /showroom/stock, /showroom/contact", async () => {
    vi.stubGlobal("fetch", showroomFetchMock());

    // /showroom — the showroom home renders OUTSIDE Clerk.
    const App = await loadStaffApp({
      hosts: "manorgarage.co.uk",
      hostname: "stockbook.example.com",
      pathname: "/showroom",
    });
    const home = render(<App />);
    expect(await screen.findByText("Quality used cars")).toBeTruthy();
    // The showroom is mounted outside the Clerk-protected dealer app.
    expect(home.container.querySelector('[data-testid="clerk-provider"]')).toBeNull();
    cleanup();

    // /showroom/stock — the public stock listing page. wouter reads
    // window.location.pathname at mount, so set it before re-rendering.
    setStaffWindow("stockbook.example.com", "/showroom/stock");
    const stock = render(<App />);
    expect(await screen.findByText("Our current stock")).toBeTruthy();
    expect(stock.container.querySelector('[data-testid="clerk-provider"]')).toBeNull();
    cleanup();

    // /showroom/contact — the public contact/enquiry page.
    setStaffWindow("stockbook.example.com", "/showroom/contact");
    const contact = render(<App />);
    expect(await screen.findByText("Send us a message")).toBeTruthy();
    expect(contact.container.querySelector('[data-testid="clerk-provider"]')).toBeNull();
  });

  it("showroom internal links resolve to /showroom-prefixed paths", async () => {
    vi.stubGlobal("fetch", showroomFetchMock());

    const App = await loadStaffApp({
      hosts: "manorgarage.co.uk",
      hostname: "stockbook.example.com",
      pathname: "/showroom",
    });

    const { container } = render(<App />);

    await screen.findByText("Quality used cars");

    // showroomHref() is /showroom-prefixed on a staff host — the exact opposite
    // of the customer-host case. Every internal link must carry the prefix.
    const links = Array.from(container.querySelectorAll("a[href]")).map(
      (a) => a.getAttribute("href") ?? "",
    );
    const internal = links.filter((h) => h.startsWith("/"));
    expect(internal.length).toBeGreaterThan(0);
    expect(internal.every((h) => h.startsWith("/showroom"))).toBe(true);
    // And a known showroom sub-page resolves under the /showroom prefix.
    expect(internal).toContain("/showroom/stock");
  });
});

// A /api/showroom response with the showroom switched off. The dealer block is
// otherwise valid so the header/footer can still render around the "switched
// off" notice.
function disabledShowroomFetchMock() {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        ...showroomPayload,
        dealer: { ...showroomPayload.dealer, showroomEnabled: false },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

// A /api/showroom response that fails (server error), exercising the showroom's
// catch → "error" fallback path.
function failingShowroomFetchMock() {
  return vi.fn(async () => new Response("boom", { status: 500 }));
}

// Like setHost above but sets a precise pathname. The real Location keeps
// pathname on its prototype, so the `{...window.location}` spread in setHost
// drops it; tests that depend on a specific showroom path must set it here.
function setCustomerWindow(hostname: string, pathname: string) {
  const origin = `https://${hostname}`;
  Object.defineProperty(window, "location", {
    value: {
      hostname,
      host: hostname,
      origin,
      protocol: "https:",
      pathname,
      search: "",
      hash: "",
      href: `${origin}${pathname}`,
    },
    writable: true,
    configurable: true,
  });
}

// The customer showroom must degrade gracefully when stock is missing, the
// showroom is switched off, or the API is unreachable — without ever leaking the
// dealer back office or rendering a broken page.
describe("Showroom degraded states (customer host)", () => {
  beforeEach(() => {
    vi.resetModules();
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("when the showroom is switched off, shows the 'currently unavailable' notice but still renders header and footer", async () => {
    vi.stubGlobal("fetch", disabledShowroomFetchMock());

    const App = await loadApp({
      hosts: "manorgarage.co.uk",
      hostname: "manorgarage.co.uk",
    });

    render(<App />);

    // The "switched off" notice replaces the live showroom content.
    await screen.findByText(/our website is currently unavailable/i);
    // The live home page (its hero headline) must NOT render in this state.
    expect(screen.queryByText("Quality used cars")).toBeNull();
    // The chrome around the notice still renders: header nav + footer.
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Manor Garage Car Sales Ltd")).toBeTruthy();
    expect(screen.getByText(/website provided by/i)).toBeTruthy();
  });

  it("falls back to the showroom home page for a non-numeric vehicle URL", async () => {
    vi.stubGlobal("fetch", showroomFetchMock());

    const App = await loadApp({
      hosts: "manorgarage.co.uk",
      hostname: "manorgarage.co.uk",
    });

    // A non-numeric slug under the showroom (e.g. a stale/typo'd link) hits the
    // /:id route, which special-cases non-numeric ids back to the home page
    // instead of trying to load a non-existent vehicle.
    setCustomerWindow("manorgarage.co.uk", "/not-a-real-car");

    render(<App />);

    // The home page renders (its hero headline), not a vehicle detail page.
    expect(await screen.findByText("Quality used cars")).toBeTruthy();
  });

  it("shows the error fallback when the /api/showroom fetch fails", async () => {
    vi.stubGlobal("fetch", failingShowroomFetchMock());

    const App = await loadApp({
      hosts: "manorgarage.co.uk",
      hostname: "manorgarage.co.uk",
    });

    render(<App />);

    // The catch path renders a friendly fallback rather than a blank/broken page.
    await screen.findByText(
      /the website is currently unavailable\. please try again later/i,
    );
    // No live showroom content leaks through on failure.
    expect(screen.queryByText("Quality used cars")).toBeNull();
  });
});
