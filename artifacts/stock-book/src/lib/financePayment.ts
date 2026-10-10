export type SchedulePayment = {
  date: string;
  amount: number;
  paymentMethod: string;
  type: string;
};

// On a finance sale the finance company settles the invoice balance payable, so
// that settlement is shown as a single "Finance" payment in the vehicle's
// payment schedule. We DERIVE it from the linked invoice (finance company +
// balance payable) rather than storing it, so it stays correct for existing
// sales, updates automatically when the sale is edited, and never double-counts.
// A sale counts as a finance sale when its invoice records a finance company.
export function deriveFinancePayment(opts: {
  financeCompanyName?: string | null;
  balancePayable?: number | null;
  saleDate?: string | null;
}): SchedulePayment | null {
  const balance = opts.balancePayable ?? 0;
  if (!(opts.financeCompanyName ?? "").trim() || balance <= 0) return null;
  return {
    date: opts.saleDate ?? "",
    amount: balance,
    paymentMethod: "Finance",
    type: "Full Payment",
  };
}
