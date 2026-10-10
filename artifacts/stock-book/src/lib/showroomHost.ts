// Decides, from the current hostname, whether this domain should serve ONLY the
// public customer showroom (mounted at the site root) instead of the dealer
// back-office app.
//
// Driven by the VITE_SHOWROOM_HOSTS build-time env var: a comma-separated list
// of hostnames for the dealership's public/customer domain(s). When unset,
// behaviour is unchanged — one combined domain serves the dealer app with the
// showroom available under /showroom. This lets the real customer domain be set
// at deploy time with no code change.

function stripWww(host: string): string {
  return host.replace(/^www\./, "");
}

const rawShowroomHosts: string = import.meta.env.VITE_SHOWROOM_HOSTS ?? "";
const showroomHosts = rawShowroomHosts
  .split(",")
  .map((h) => stripWww(h.trim().toLowerCase()))
  .filter(Boolean);

// True when the current hostname is one of the configured customer/showroom
// domains. www/apex variants are treated as the same domain.
export const isShowroomHost: boolean = (() => {
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
