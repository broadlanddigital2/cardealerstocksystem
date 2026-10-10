/** Round a money value to pennies (2dp, half-up, EPSILON-guarded). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * VAT Margin Scheme calculations.
 * margin = sale - purchase
 * vatDue = one-sixth (16.67%) of a positive margin, else 0
 * netMargin = margin - vatDue
 */
export function computeMargins(purchasePrice: number, salePrice: number | null) {
  if (salePrice == null) {
    return { margin: null, vatDue: null, netMargin: null };
  }
  const margin = round2(salePrice - purchasePrice);
  const vatDue = margin > 0 ? round2(margin / 6) : 0;
  const netMargin = round2(margin - vatDue);
  return { margin, vatDue, netMargin };
}
