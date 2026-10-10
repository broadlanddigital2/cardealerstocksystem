const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Returns the inclusive start and exclusive end (as "YYYY-MM-DD" strings) of the
 * VAT period containing `now`, plus a human-friendly label, based on the dealer's
 * VAT return period setting. Defaults to Stagger 1 when unset.
 */
export function vatPeriodRange(now: Date, vatQuarter: string | null) {
  const y = now.getFullYear();
  const m0 = now.getMonth(); // 0-11
  const absMonth = y * 12 + m0;

  let startAbs: number;
  let lengthMonths: number;

  if (vatQuarter === "monthly") {
    startAbs = absMonth;
    lengthMonths = 1;
  } else if (vatQuarter === "annual") {
    startAbs = y * 12; // January of the current year
    lengthMonths = 12;
  } else {
    // Quarterly staggers. shift = months the period boundaries are offset by.
    const shift =
      vatQuarter === "stagger_2" ? 1 : vatQuarter === "stagger_3" ? 2 : 0;
    startAbs = Math.floor((absMonth - shift) / 3) * 3 + shift;
    lengthMonths = 3;
  }

  const endAbs = startAbs + lengthMonths;
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (abs: number) =>
    `${Math.floor(abs / 12)}-${pad((abs % 12) + 1)}-01`;

  const startMonthName = MONTH_NAMES[startAbs % 12];
  const startYear = Math.floor(startAbs / 12);
  const lastAbs = endAbs - 1;
  const endMonthName = MONTH_NAMES[lastAbs % 12];
  const endYear = Math.floor(lastAbs / 12);

  let label: string;
  if (lengthMonths === 1) {
    label = `${startMonthName} ${startYear}`;
  } else if (startYear === endYear) {
    label = `${startMonthName}–${endMonthName} ${startYear}`;
  } else {
    label = `${startMonthName} ${startYear} – ${endMonthName} ${endYear}`;
  }

  return { startStr: fmt(startAbs), endExclusiveStr: fmt(endAbs), label };
}
