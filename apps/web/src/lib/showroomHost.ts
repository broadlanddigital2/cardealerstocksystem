// Decides, from the current hostname, whether this domain should serve ONLY the
// public customer showroom (mounted at the site root) instead of the dealer
// back-office app.
//
// The list of showroom hostnames comes from the SHOWROOM_HOSTS Worker secret,
// which the central console sets whenever a dealer's own address is added or
// removed (so no rebuild is needed). NEXT_PUBLIC_SHOWROOM_HOSTS is still read as
// a build-time fallback. When neither is set, one combined domain serves the
// dealer app with the showroom available under /showroom.
//
// The browser can't see the runtime secret, so middleware.ts marks showroom
// responses with the SHOWROOM_COOKIE cookie and the page reads that.

function stripWww(host: string): string {
  return host.replace(/^www\./, "");
}

export const SHOWROOM_COOKIE = "showroom_site";

const rawShowroomHosts: string = process.env.NEXT_PUBLIC_SHOWROOM_HOSTS ?? "";

function hasShowroomCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim() === `${SHOWROOM_COOKIE}=1`);
}
const showroomHosts = rawShowroomHosts
  .split(",")
  .map((h) => stripWww(h.trim().toLowerCase()))
  .filter(Boolean);

// True when the current hostname is one of the configured customer/showroom
// domains. www/apex variants are treated as the same domain.
export const isShowroomHost: boolean = (() => {
  if (typeof window === "undefined") return false;
  if (hasShowroomCookie()) return true;
  if (showroomHosts.length === 0) return false;
  const current = stripWww(window.location.hostname.toLowerCase());
  return showroomHosts.includes(current);
})();

// Path prefix for showroom routes and internal links: empty on the customer
// domain (the showroom is mounted at the site root) and "/showroom" on the
// combined/staff domain.
export const showroomBase = isShowroomHost ? "" : "/showroom";

// Build an internal showroom link. `sub` is the part after the base, e.g. ""
// (home), "/stock", "/contact", or "/123" for a vehicle. Returns "/" for the
// home link on the customer domain so wouter always gets a valid path.
export function showroomHref(sub = ""): string {
  const path = `${showroomBase}${sub}`;
  return path === "" ? "/" : path;
}

/** Showroom hosts known at request time: the console-managed secret plus the build-time list. */
export function runtimeShowroomHosts(): string {
  return [process.env.SHOWROOM_HOSTS ?? "", rawShowroomHosts].filter(Boolean).join(",");
}

// Server-side variant used by middleware.ts (takes the request host).
export function isShowroomHostname(hostname: string, raw = runtimeShowroomHosts()): boolean {
  const hosts = raw
    .split(",")
    .map((h) => stripWww(h.trim().toLowerCase()))
    .filter(Boolean);
  if (hosts.length === 0) return false;
  return hosts.includes(stripWww(hostname.split(":")[0]!.toLowerCase()));
}
