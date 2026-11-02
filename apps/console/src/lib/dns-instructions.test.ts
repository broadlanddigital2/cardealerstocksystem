import { describe, expect, it } from "vitest";
import { buildInstructions, hostFor } from "./dns-instructions";

describe("DNS instructions", () => {
  it("writes hosts the way DNS providers ask for them", () => {
    expect(hostFor("@", "manorgcs.co.uk")).toBe("@");
    expect(hostFor("manorgcs.co.uk", "manorgcs.co.uk")).toBe("@");
    expect(hostFor("_dmarc", "manorgcs.co.uk")).toBe("_dmarc");
    expect(hostFor("stock.manorgcs.co.uk", "manorgcs.co.uk")).toBe("stock");
  });
  it("lists every record with MX priority, and escapes the HTML", () => {
    const i = buildInstructions({
      dealerName: "Manor <Garage>",
      domain: "manorgcs.co.uk",
      purpose: "email",
      records: [
        { type: "MX", name: "@", value: "mail.trekmail.net.", priority: 10 },
        { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=quarantine" },
      ],
    });
    expect(i.text).toContain("Type: MX");
    expect(i.text).toContain("Value: mail.trekmail.net");
    expect(i.text).toContain("Priority: 10");
    expect(i.text).toContain("Host / Name: _dmarc");
    expect(i.html).not.toContain("<Garage>");
    expect(i.subject).toBe("DNS records to set up email for manorgcs.co.uk");
  });
});
