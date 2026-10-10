import { describe, it, expect } from "vitest";

import { showroomRewritePath } from "./middleware";
import { isShowroomHostname } from "@/lib/showroomHost";

describe("showroom host routing", () => {
  it("maps the customer-domain root and known pages onto /showroom", () => {
    expect(showroomRewritePath("/")).toBe("/showroom");
    expect(showroomRewritePath("/stock")).toBe("/showroom/stock");
    expect(showroomRewritePath("/contact")).toBe("/showroom/contact");
    expect(showroomRewritePath("/privacy")).toBe("/showroom/privacy");
    expect(showroomRewritePath("/cookies")).toBe("/showroom/cookies");
    expect(showroomRewritePath("/123")).toBe("/showroom/123");
  });

  it("never exposes back-office paths on the customer domain", () => {
    expect(showroomRewritePath("/settings")).toBe("/showroom");
    expect(showroomRewritePath("/reports")).toBe("/showroom");
    expect(showroomRewritePath("/vehicles/12")).toBe("/showroom");
    expect(showroomRewritePath("/sign-in")).toBe("/showroom");
  });

  it("matches configured hosts, treating www/apex alike and ignoring ports", () => {
    const hosts = "manorgcs.co.uk,www.manorgcs.co.uk";
    expect(isShowroomHostname("manorgcs.co.uk", hosts)).toBe(true);
    expect(isShowroomHostname("www.manorgcs.co.uk", hosts)).toBe(true);
    expect(isShowroomHostname("manorgcs.co.uk:443", hosts)).toBe(true);
    expect(isShowroomHostname("stock.motormetric-mg.co.uk", hosts)).toBe(false);
    expect(isShowroomHostname("manorgcs.co.uk", "")).toBe(false);
  });
});
