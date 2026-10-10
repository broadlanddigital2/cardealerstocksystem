import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// showroomHost.ts reads NEXT_PUBLIC_SHOWROOM_HOSTS and window.location.hostname once,
// at module-evaluation time. Each test therefore sets the env + hostname first,
// resets the module registry, then imports a fresh copy of the module.
async function loadModule(opts: { hosts?: string; hostname: string }) {
  if (opts.hosts === undefined) {
    vi.stubEnv("NEXT_PUBLIC_SHOWROOM_HOSTS", "");
  } else {
    vi.stubEnv("NEXT_PUBLIC_SHOWROOM_HOSTS", opts.hosts);
  }
  Object.defineProperty(window, "location", {
    value: { ...window.location, hostname: opts.hostname },
    writable: true,
    configurable: true,
  });
  vi.resetModules();
  return import("./showroomHost");
}

describe("showroomHost", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("isShowroomHost", () => {
    it("returns false when NEXT_PUBLIC_SHOWROOM_HOSTS is unset", async () => {
      const mod = await loadModule({ hostname: "manorgarage.co.uk" });
      expect(mod.isShowroomHost).toBe(false);
    });

    it("returns false when NEXT_PUBLIC_SHOWROOM_HOSTS is empty/blank", async () => {
      const mod = await loadModule({ hosts: "  , ", hostname: "manorgarage.co.uk" });
      expect(mod.isShowroomHost).toBe(false);
    });

    it("matches a configured apex host", async () => {
      const mod = await loadModule({
        hosts: "manorgarage.co.uk",
        hostname: "manorgarage.co.uk",
      });
      expect(mod.isShowroomHost).toBe(true);
    });

    it("matches when configured apex but visitor is on www", async () => {
      const mod = await loadModule({
        hosts: "manorgarage.co.uk",
        hostname: "www.manorgarage.co.uk",
      });
      expect(mod.isShowroomHost).toBe(true);
    });

    it("matches when configured www but visitor is on apex", async () => {
      const mod = await loadModule({
        hosts: "www.manorgarage.co.uk",
        hostname: "manorgarage.co.uk",
      });
      expect(mod.isShowroomHost).toBe(true);
    });

    it("is case-insensitive and trims whitespace in the host list", async () => {
      const mod = await loadModule({
        hosts: " ManorGarage.co.uk , other.example ",
        hostname: "MANORGARAGE.CO.UK",
      });
      expect(mod.isShowroomHost).toBe(true);
    });

    it("matches any host in a multi-host list", async () => {
      const mod = await loadModule({
        hosts: "first.example,second.example",
        hostname: "second.example",
      });
      expect(mod.isShowroomHost).toBe(true);
    });

    it("returns false for a non-configured (staff) host", async () => {
      const mod = await loadModule({
        hosts: "manorgarage.co.uk",
        hostname: "app.stockbook.example",
      });
      expect(mod.isShowroomHost).toBe(false);
    });

    it("does not match on a partial/substring host", async () => {
      const mod = await loadModule({
        hosts: "manorgarage.co.uk",
        hostname: "notmanorgarage.co.uk",
      });
      expect(mod.isShowroomHost).toBe(false);
    });
  });

  describe("showroomHref", () => {
    it("returns root-based links on a customer (showroom) host", async () => {
      const mod = await loadModule({
        hosts: "manorgarage.co.uk",
        hostname: "manorgarage.co.uk",
      });
      expect(mod.showroomBase).toBe("");
      expect(mod.showroomHref()).toBe("/");
      expect(mod.showroomHref("/stock")).toBe("/stock");
      expect(mod.showroomHref("/contact")).toBe("/contact");
      expect(mod.showroomHref("/123")).toBe("/123");
    });

    it("returns /showroom-prefixed links on the staff/combined host", async () => {
      const mod = await loadModule({ hostname: "app.stockbook.example" });
      expect(mod.showroomBase).toBe("/showroom");
      expect(mod.showroomHref()).toBe("/showroom");
      expect(mod.showroomHref("/stock")).toBe("/showroom/stock");
      expect(mod.showroomHref("/contact")).toBe("/showroom/contact");
      expect(mod.showroomHref("/123")).toBe("/showroom/123");
    });
  });
});
