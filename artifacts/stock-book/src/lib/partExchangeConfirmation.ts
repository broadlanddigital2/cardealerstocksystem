import { formatCurrency } from "./format";

/** Compare against the VAT-inclusive vehicle price, not the net price. */
export function partExchangeConfirmation(input: {
  salePrice: number;
  saleVat?: number;
  partExchangeAllowance: number;
  balancePayable: number;
}): string | null {
  const gross = Math.round((input.salePrice + (input.saleVat ?? 0)) * 100);
  if (Math.round(input.partExchangeAllowance * 100) <= gross) return null;
  const settlement = input.balancePayable < 0
    ? `The vehicle invoice will show ${formatCurrency(Math.abs(input.balancePayable))} due to the customer.`
    : `The remaining vehicle invoice balance is ${formatCurrency(input.balancePayable)} after deposits and included extras.`;
  return `The part-exchange allowance of ${formatCurrency(input.partExchangeAllowance)} is higher than the vehicle sale price of ${formatCurrency(gross / 100)} (including VAT).\n\n${settlement}\n\nIs this correct? Select OK to continue or Cancel to check the figures.`;
}
