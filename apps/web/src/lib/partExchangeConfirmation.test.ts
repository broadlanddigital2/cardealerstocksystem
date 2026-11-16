import { describe, expect, it } from "vitest";
import { partExchangeConfirmation } from "./partExchangeConfirmation";

describe("part-exchange confirmation", () => {
  it("confirms the B-Max scenario with the amount due to the customer", () => {
    const message = partExchangeConfirmation({ salePrice: 5495, partExchangeAllowance: 9000, balancePayable: -3505 });
    expect(message).toContain("£9,000.00");
    expect(message).toContain("£3,505.00 due to the customer");
  });
  it("does not interrupt ordinary or equal-value exchanges", () => {
    for (const px of [0, 1000, 5495]) {
      expect(partExchangeConfirmation({ salePrice: 5495, partExchangeAllowance: px, balancePayable: 5495 - px })).toBeNull();
    }
  });
  it("compares against VAT-inclusive price", () => {
    expect(partExchangeConfirmation({ salePrice: 5000, saleVat: 1000, partExchangeAllowance: 5500, balancePayable: 500 })).toBeNull();
  });
  it("uses the actual invoice balance including deposit", () => {
    expect(partExchangeConfirmation({ salePrice: 5495, partExchangeAllowance: 9000, balancePayable: -4005 })).toContain("£4,005.00 due to the customer");
  });
  it("still confirms a high allowance when included extras offset it", () => {
    expect(partExchangeConfirmation({ salePrice: 5000, partExchangeAllowance: 6000, balancePayable: 500 })).toContain("remaining vehicle invoice balance is £500.00");
  });
});
