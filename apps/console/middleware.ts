import { NextResponse, type NextRequest } from "next/server";

// Cheap first gate: no session cookie -> sign-in page. Every page and action
// still checks the session properly (src/lib/auth.ts).
export function middleware(req: NextRequest) {
  if (!req.cookies.get("console_session")) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!sign-in|_next|favicon).*)"],
};
