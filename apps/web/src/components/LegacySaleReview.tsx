import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getVehicle, useApproveLegacySaleReview } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const money = (n: number | null | undefined) => n == null ? "Not recorded" : `£${n.toFixed(2)}`;
export default function LegacySaleReview({ vehicleId, onApproved }: { vehicleId: number; onApproved: (reason: string) => void }) {
  const [vehicle, setVehicle] = useState<Awaited<ReturnType<typeof getVehicle>>>();
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const mutation = useApproveLegacySaleReview();
  const qc = useQueryClient();
  useEffect(() => {
    let active = true;
    getVehicle(vehicleId).then(v => { if (active) setVehicle(v); }).catch(() => { if (active) setError("Could not load the figures. Close and reopen the refund screen."); });
    return () => { active = false; };
  }, [vehicleId]);
  const invoice = vehicle?.editInvoice;
  if (!vehicle) return <p role={error ? "alert" : "status"}>{error || "Loading figures for document review…"}</p>;
  if (!invoice || !vehicle.editVersion) return <p role="alert">The saved invoice is missing. Recover the original invoice before reviewing this sale; approval cannot be based on vehicle details alone.</p>;
  const fields = [
    ["Vehicle", `${vehicle.stockNumber} / ${vehicle.registrationNumber}`],
    ["Purchase date", vehicle.purchaseDate], ["Seller", vehicle.sellerName],
    ["Purchase reference", vehicle.purchaseInvoiceNumber || vehicle.purchaseNumber],
    ["Purchase price", money(vehicle.purchasePrice)], ["Purchase VAT", money(vehicle.purchaseVat)],
    ["Auction fees excluding VAT", money(vehicle.auctionCostNoVat)], ["Auction fees including VAT", money(vehicle.auctionCostWithVat)],
    ["Total purchase cost", money(vehicle.totalPurchaseCost)],
    ["VAT scheme", vehicle.vatQualifying ? "VAT qualifying" : "Margin scheme"],
    ["Sale date", vehicle.saleDate], ["Invoice date", invoice.invoiceDate],
    ["Invoice number", invoice.invoiceNumber], ["Buyer", invoice.customerName],
    ["Buyer address", invoice.customerAddress],
    ["Vehicle sale price", money(vehicle.salePrice)], ["Invoice sale price", money(invoice.salePrice)],
    ["Invoice sale VAT", money(invoice.saleVat)], ["Margin VAT", money(vehicle.vatDue)],
    ["Invoice deposit", money(invoice.holdingDeposit)], ["Vehicle deposit", money(vehicle.holdingDepositAmount)],
    ["Part exchange", money(invoice.partExchangeAllowance)], ["Invoice balance payable", money(invoice.balancePayable)],
    ["Finance company", invoice.financeCompanyName || "None"], ["Payment method", invoice.paymentMethod || "Not recorded"],
  ];
  return <form className="space-y-3 border rounded-md p-4" onSubmit={async e => {
    e.preventDefault(); setError("");
    if (!confirmed || !reason.trim()) { setError("Approve the details and enter a reason for the refund."); return; }
    try {
      await mutation.mutateAsync({ id: vehicleId, data: { expectedEditVersion: vehicle.editVersion!,
        refundReason: reason.trim(), confirmed } });
      onApproved(reason.trim());
      await qc.invalidateQueries();
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      setError(e.data?.error ?? e.message ?? "Review was not saved.");
    }
  }}>
    <h3 className="font-semibold">Approve sale details</h3>
    <p className="text-sm">These are the current saved figures, not yet verified historical evidence. Check them against the original purchase and sale documents. If anything differs, close this screen, correct the records, and reopen to review again. Do not approve estimates.</p>
    <dl className="grid grid-cols-2 gap-2 text-sm">{fields.map(([name, value]) => <div className="contents" key={name}><dt className="font-medium">{name}</dt><dd className="whitespace-pre-wrap break-words">{value || "Not recorded"}</dd></div>)}</dl>
    <div className="text-sm"><strong>Invoice extras</strong>{invoice.extras?.length ? <ul>{invoice.extras.map((e, i) => <li key={i}>{e.description}: {money(e.amount)} + VAT {money(e.vat ?? 0)}; {e.onFinanceInvoice ? "finance invoice" : "extras invoice"}</li>)}</ul> : <p>None</p>}</div>
    <label className="flex gap-2 text-sm"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I approve the details above and confirm they match the original documents. This approval and my identity will be retained permanently.</label>
    <Label htmlFor="review-refund-reason">Reason for refund</Label><Textarea id="review-refund-reason" required maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} />
    <p className="text-sm">Approval does not refund money or cancel the sale. Finance and part-exchange settlement checks still apply.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <Button type="submit" disabled={mutation.isPending || !confirmed || !reason.trim()}>Approve details and continue</Button>
  </form>;
}
