import { NextResponse, type NextRequest } from "next/server";
import { SHOWROOM_COOKIE, isShowroomHostname } from "@/lib/showroomHost";

/**
 * Two web addresses, one deployment.
 *
 * When the request host is one of the showroom hosts (SHOWROOM_HOSTS, set by
 * the console, or NEXT_PUBLIC_SHOWROOM_HOSTS), only the public showroom is served, mounted at the site
 * root: "/" "/stock" "/contact" "/privacy" "/cookies" and numeric "/:id".
 * Everything else on that domain resolves to the showroom home, so the back
 * office is never reachable there. Other hosts get the dealer app at the root
 * and the showroom under /showroom (unchanged behaviour).
 */
export function showroomRewritePath(pathname: string): string {
  const SHOWROOM_PAGES = new Set(["/stock", "/contact", "/privacy", "/cookies"]);
  if (pathname === "/" || pathname === "") return "/showroom";
  if (SHOWROOM_PAGES.has(pathname)) return `/showroom${pathname}`;
  if (/^\/\d+$/.test(pathname)) return `/showroom${pathname}`;
  return "/showroom";
}

function hostOf(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("host") || req.nextUrl.hostname;
}

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api")) return NextResponse.next();
  if (isShowroomHostname(hostOf(req))) {
    const url = req.nextUrl.clone();
    url.pathname = showroomRewritePath(pathname);
    const res = NextResponse.rewrite(url);
    // Tells the page (which can't read the runtime host list) to mount the
    // showroom at the site root.
    res.cookies.set(SHOWROOM_COOKIE, "1", { path: "/", sameSite: "lax", secure: req.nextUrl.protocol === "https:" });
    return res;
  }
  const res = NextResponse.next();
  if (req.cookies.has(SHOWROOM_COOKIE)) res.cookies.delete(SHOWROOM_COOKIE);
  return res;
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|txt)).*)",
  ],
};
