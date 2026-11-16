import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { AccountingHistoryEntry } from "@workspace/api-client-react";

/** Generated only from the saved, append-only refund event, never form values. */
export function downloadRefundReceipt(entry: AccountingHistoryEntry) {
  if (entry.type !== "refund") throw new Error("A saved sale refund is required.");
  const reference = `RF-${entry.id.replace(/^refund-/, "")}`;
  const pdf = new jsPDF();
  pdf.setFontSize(20);
  pdf.text("REFUND RECEIPT", 14, 22);
  pdf.setFontSize(11);
  pdf.text(reference, 14, 31);
  autoTable(pdf, {
    startY: 39, theme: "grid", head: [["Detail", "Recorded value"]],
    body: [
      ["Refund receipt", reference],
      ["Payment date", entry.date],
      ["Amount refunded (GBP)", entry.amount.toFixed(2)],
      ["Paid to", entry.recipient],
      ["Payment method", entry.method],
      ["Payment reference", entry.reference],
      ["Vehicle", entry.registration],
      ["Original invoice", entry.invoiceNumber],
      ["Cancellation credit", entry.creditNumber],
      ["Reason", entry.reason],
      ["Recorded by", entry.actor],
      ["Recorded at", entry.recordedAt],
      ["Confirmation", "Payment recorded as made outside the app. This receipt does not initiate a transfer or create an additional VAT credit."],
    ],
    styles: { fontSize: 10, overflow: "linebreak" }, columnStyles: { 0: { cellWidth: 48 } },
  });
  pdf.save(`${reference}.pdf`);
}
