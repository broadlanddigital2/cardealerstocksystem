import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListAccountingHistory, useConfirmSaleRefund, type AccountingHistoryEntry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadRefundReceipt } from "@/lib/refundReceipt";

export default function VehicleRefund({ creditId, initialReason }: { creditId: number; initialReason: string }) {
  const history = useListAccountingHistory();
  const mutation = useConfirmSaleRefund();
  const qc = useQueryClient();
  const [reason, setReason] = useState(initialReason);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [recipient, setRecipient] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [requestKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<AccountingHistoryEntry | null>(null);
  const credit = history.data?.find(r => r.type === "credit" && r.creditId === creditId);
  if (saved) return <div className="space-y-3" role="status">
    <p>Refund of £{saved.amount.toFixed(2)} recorded on {saved.date}. The vehicle has returned to internal stock, hidden from the showroom.</p>
    <Button onClick={() => downloadRefundReceipt(saved)}>Download refund receipt</Button>
    {saved.returnedVehicleId && <Link className="block underline" href={`/vehicles/${saved.returnedVehicleId}`}>Open returned stock</Link>}
  </div>;
  if (history.isLoading) return <p>Loading refund balance…</p>;
  if (history.error) return <p role="alert">Cannot load refund balance. Close and reopen this dialog to retry.</p>;
  if (!credit) return <p role="alert">Credit record could not be loaded. Refresh before recording a refund.</p>;
  if (!credit.canRefund) return <p>{credit.refundState === "fully refunded" ? "This sale is already fully refunded." : credit.refundDue === 0 ? "No money is due back on this sale." : "This vehicle is not eligible for a refund."}</p>;
  return <form className="space-y-3" onSubmit={async e => {
    e.preventDefault(); setError("");
    if (!reason.trim()) { setError("Enter the reason for the refund."); return; }
    try {
      const result = await mutation.mutateAsync({ id: creditId, data: {
        amount: credit.refundDue, reason: reason.trim(), paymentDate: date,
        recipient: recipient.trim() || credit.recipient, method, reference, requestKey,
      } });
      setSaved(result); await qc.invalidateQueries();
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      setError(e.data?.error ?? e.message ?? "Refund was not confirmed.");
    }
  }}>
    <h3 className="font-semibold">Full refund — £{credit.refundDue.toFixed(2)}</h3>
    <p className="text-sm">Confirm the money paid back outside this app. This completes the refund and restores internal stock, without publishing the vehicle on the showroom.</p>
    <Label htmlFor="vehicle-refund-reason">Reason for refund</Label><Textarea id="vehicle-refund-reason" required maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} />
    <Label htmlFor="vehicle-refund-date">Refund date</Label><Input id="vehicle-refund-date" type="date" required min={credit.creditDate} max={new Date().toISOString().slice(0, 10)} value={date} onChange={e => setDate(e.target.value)} />
    <Label htmlFor="vehicle-refund-recipient">Paid to</Label><Input id="vehicle-refund-recipient" required value={recipient || credit.recipient} onChange={e => setRecipient(e.target.value)} />
    <Label htmlFor="vehicle-refund-method">Payment method</Label><Input id="vehicle-refund-method" required value={method} onChange={e => setMethod(e.target.value)} />
    <Label htmlFor="vehicle-refund-reference">Unique payment reference</Label><Input id="vehicle-refund-reference" required value={reference} onChange={e => setReference(e.target.value)} />
    <label className="flex gap-2 text-sm"><input type="checkbox" required />I confirm this refund has been paid and has not been recorded before. No automatic money transfer will be made.</label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <Button type="submit" variant="destructive" disabled={mutation.isPending}>Confirm full refund</Button>
  </form>;
}
