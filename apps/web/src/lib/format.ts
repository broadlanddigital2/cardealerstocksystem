import { format, parseISO } from "date-fns";

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "£0.00";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(amount);
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "-";
  try {
    return format(parseISO(dateString), "dd/MM/yyyy");
  } catch (e) {
    return dateString;
  }
}
