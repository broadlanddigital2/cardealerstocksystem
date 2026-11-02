import { describe, expect, it } from "vitest";
import { describeResult, fqdn } from "./cloudflare-dns";

describe("Cloudflare DNS helpers", () => {
  it("turns record names into full names", () => {
    expect(fqdn("@", "manorgcs.co.uk")).toBe("manorgcs.co.uk");
    expect(fqdn("_dmarc", "manorgcs.co.uk")).toBe("_dmarc.manorgcs.co.uk");
    expect(fqdn("stock.manorgcs.co.uk.", "manorgcs.co.uk")).toBe("stock.manorgcs.co.uk");
    expect(fqdn("dkim._domainkey", "mailtest.racecargraphics.uk")).toBe("dkim._domainkey.mailtest.racecargraphics.uk");
  });
  it("summarises what changed", () => {
    expect(describeResult({ added: ["a"], replaced: ["b"], unchanged: [], skipped: ["CNAME x: A record already there"] })).toBe(
      "Cloudflare DNS: 1 added, 1 replaced. Not changed: CNAME x: A record already there.",
    );
  });
});
