import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, sessionCookie, sessionToken } from "../lib/session";

describe("sessionToken", () => {
  it("reads the session cookie among others", () => {
    expect(sessionToken({ cookie: `a=1; ${SESSION_COOKIE}=abc%2Ddef; b=2` })).toBe("abc-def");
  });
  it("prefers a Bearer token", () => {
    expect(sessionToken({ authorization: "Bearer tok123", cookie: `${SESSION_COOKIE}=x` })).toBe("tok123");
  });
  it("returns null when absent", () => {
    expect(sessionToken({})).toBeNull();
    expect(sessionToken({ cookie: "other=1" })).toBeNull();
  });
});

describe("sessionCookie", () => {
  it("sets an HttpOnly, SameSite=Lax cookie, Secure on https", () => {
    const c = sessionCookie("tok", 60, true);
    expect(c).toContain(`${SESSION_COOKIE}=tok`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=60");
    expect(c).toContain("Secure");
  });
  it("clears the cookie when signing out", () => {
    const c = sessionCookie(null, 0, false);
    expect(c).toContain(`${SESSION_COOKIE}=;`);
    expect(c).toContain("Max-Age=0");
    expect(c).not.toContain("Secure");
  });
});
