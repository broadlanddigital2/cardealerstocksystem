import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { useGetCancellationState, useCancelIssuedSale, getGetCancellationStateQueryKey } from "@workspace/api-client-react";
import { useAccess } from "@/components/app/access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import VehicleRefund from "./VehicleRefund";
import LegacySaleReview from "./LegacySaleReview";

export function accountingError(error: unknown) {
  const e = error as { data?: { error?: string }; message?: string };
  return e?.data?.error ?? e?.message ?? "The request failed. Nothing has been confirmed; refresh and check history before retrying.";
}

export default function SaleCancellation({ vehicleId, startRefund = false }: { vehicleId: number; startRefund?: boolean }) {
  const { isAdmin } = useAccess();
  const query = useGetCancellationState(vehicleId, { query: { queryKey: getGetCancellationStateQueryKey(vehicleId), refetchInterval: 30000 } });
  const mutation = useCancelIssuedSale();
  const qc = useQueryClient();
  const [open, setOpen] = useState(startRefund);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [received, setReceived] = useState("");
  const [reconciliation, setReconciliation] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const state = query.data;
  return <Card className="my-4 border-amber-200">
    <CardHeader><CardTitle>Issued sale &amp; cancellation</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      {query.isLoading && <p>Checking retained accounting…</p>}
      {query.error && <p role="alert" className="text-red-700">{accountingError(query.error)}</p>}
      {state && <p>{state.message}</p>}
      {isAdmin && startRefund && state?.reviewRequired && <LegacySaleReview vehicleId={vehicleId} onApproved={setReason} />}
      {state?.cancelled && <p className="font-semibold">Full credit: {state.creditNumber}. History is permanent and cannot be edited or deleted.</p>}
      {startRefund && isAdmin && state?.cancelled && state.creditId && <VehicleRefund creditId={state.creditId} initialReason={reason} />}
      <p className="text-sm text-slate-600">The original sale remains in its original period. A credit reverses sales and output VAT on its cancellation date, not the purchase. Completing the full refund automatically creates linked internal stock for resale, unpublished on the showroom website. The original sale remains here permanently.</p>
      {isAdmin && <Link href="/cancelled-invoices" className="text-primary underline">Cancelled Invoices — credits and refunds</Link>}
      {isAdmin && state?.eligible && !open && <div><Button variant="destructive" onClick={() => { setOpen(true); setError(""); }}>Approve full cancellation</Button></div>}
      {isAdmin && state?.eligible && open && <form className="space-y-3 max-w-xl" onSubmit={async e => {
        e.preventDefault(); setError("");
        if (!confirmed || received === "") { setError("Confirm the receipt reconciliation and enter the actual amount received, including deposits."); return; }
        try {
          await mutation.mutateAsync({ id: vehicleId, data: { reason, cancellationDate: date, receivedAmount: Number(received), reconciliation, receiptsConfirmed: true } });
          setOpen(false); await qc.invalidateQueries();
        } catch (err) { setError(accountingError(err)); }
      }}>
        <p>First approve the full cancellation, then confirm the refund payment below. Full credit gross: £{state.gross.toFixed(2)}. Included holding deposit: £{state.deposit.toFixed(2)}.</p>
        <Label htmlFor="cancel-date">Cancellation date</Label><Input id="cancel-date" type="date" required max={new Date().toISOString().slice(0, 10)} value={date} onChange={e => setDate(e.target.value)} />
        <Label htmlFor="cancel-reason">Reason for refund (permanent)</Label><Textarea id="cancel-reason" required value={reason} onChange={e => setReason(e.target.value)} />
        <Label htmlFor="cancel-received">Total actually received, including deposit (£)</Label><Input id="cancel-received" type="number" min={state.deposit} max={state.gross} step=".01" required value={received} onChange={e => setReceived(e.target.value)} />
        <Label htmlFor="cancel-reconciliation">Receipt reconciliation — payments, deposit, unpaid balance and evidence</Label><Textarea id="cancel-reconciliation" required value={reconciliation} onChange={e => setReconciliation(e.target.value)} />
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reconciled all receipts including deposits and unpaid amounts. There is no unresolved finance or part-exchange settlement. This approval is permanent and does not transfer money.</label>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <div className="flex gap-2"><Button type="submit" variant="destructive" disabled={mutation.isPending}>Approve cancellation and continue to refund</Button><Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>Back</Button></div>
      </form>}
    </CardContent>
  </Card>;
}
