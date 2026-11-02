import { describe, expect, it } from "vitest";
import { cleanLocalPart, emailDomainFor, forwardingAddress } from "./trekmail";

describe("email helpers", () => {
  it("accepts and tidies the part before the @", () => {
    expect(cleanLocalPart(" John.Smith ")).toBe("john.smith");
    expect(cleanLocalPart("sales@whatever.com")).toBe("sales");
    expect(() => cleanLocalPart("-bad")).toThrow();
    expect(() => cleanLocalPart("two words")).toThrow();
    expect(() => cleanLocalPart("")).toThrow();
  });
  it("uses the web domain without www as the email domain", () => {
    expect(emailDomainFor({ emailDomain: null, webDomain: "www.manorgcs.co.uk" })).toBe("manorgcs.co.uk");
    expect(emailDomainFor({ emailDomain: "mail.example.com", webDomain: "example.com" })).toBe("mail.example.com");
    expect(emailDomainFor({ emailDomain: null, webDomain: null })).toBeNull();
  });
  it("names forwarding addresses whatever shape TrekMail returns", () => {
    expect(forwardingAddress({ id: 1, local_part: "sales", recipients: [] }, "x.co.uk")).toBe("sales@x.co.uk");
    expect(forwardingAddress({ id: 2, email: "info@x.co.uk", recipients: [] }, "x.co.uk")).toBe("info@x.co.uk");
  });
});
