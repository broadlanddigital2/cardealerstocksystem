import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListAccountingHistory, useConfirmSaleRefund, getListAccountingHistoryQueryKey, type AccountingHistoryEntry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { accountingError } from "@/components/SaleCancellation";
import { toCsv } from "@workspace/report-calc";
import { downloadRefundReceipt } from "@/lib/refundReceipt";
import { Link } from "wouter";
import VehicleSaleHistory from "@/components/VehicleSaleHistory";

type Snap = Record<string, unknown> | null | undefined;
const LABELS: Record<string, string> = { salePrice: "Sale price", saleVat: "Sale VAT", saleDate: "Sale date", buyerName: "Buyer", buyerAddress: "Buyer address", purchasePrice: "Purchase price", purchaseVat: "Purchase VAT", purchaseDate: "Purchase date", sellerName: "Seller", registrationNumber: "Registration", invoiceNumber: "Invoice number", salesInvoiceNumber: "Sales invoice number", balancePayable: "Balance payable", partExchangeAllowance: "Part exchange allowance" };
const label = (k: string) => LABELS[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
const show = (v: unknown) => v == null || v === "" ? "(blank)" : typeof v === "object" ? JSON.stringify(v) : String(v);
export function correctionChanges(raw: string): Array<{ section: string; field: string; before: string; after: string }> {
  let doc: Record<string, Snap> = {};
  try { doc = JSON.parse(raw) ?? {}; } catch { return []; }
  const out: Array<{ section: string; field: string; before: string; after: string }> = [];
  for (const [section, b, a] of [["Vehicle", doc.beforeVehicle, doc.afterVehicle], ["Invoice", doc.beforeInvoice, doc.afterInvoice]] as const) {
    const keys = new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})]);
    for (const k of keys) { if (/^(updatedAt|editVersion)$/.test(k)) continue; const x = show(b?.[k]), y = show(a?.[k]); if (x !== y) out.push({ section, field: label(k), before: x, after: y }); }
  }
  return out;
}
const money = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
export default function CancelledInvoices() {
  useEffect(() => { window.document.title = "Accounting History — cancellations, refunds and corrections — MotorMetric"; }, []);
  const query = useListAccountingHistory({ query: { queryKey: getListAccountingHistoryQueryKey(), refetchInterval: 30000 } });
  const mutation = useConfirmSaleRefund();
  const qc = useQueryClient();
  const [historyVehicleId, setHistoryVehicleId] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("all");
  const [selected, setSelected] = useState<AccountingHistoryEntry | null>(null);
  const [document, setDocument] = useState<AccountingHistoryEntry | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [recipient, setRecipient] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [error, setError] = useState("");
  const [savedRefund, setSavedRefund] = useState<AccountingHistoryEntry | null>(null);
  const rows = (query.data ?? []).filter(r => (!from || r.date >= from) && (!to || r.date <= to) && (type === "all" || r.type === type));
  const openDocument = (entry: AccountingHistoryEntry) => setDocument(entry.type === "correction" || entry.type === "review" ? entry : (query.data ?? []).find(r => r.type === "credit" && r.creditId === entry.creditId) ?? entry);
  const exportCsv = () => {
    const headers = ["Type", "Original invoice", "Original date", "Vehicle", "Credit", "Credit date", "Event date", "Gross/event amount", "Net credit", "VAT credit", "Reason", "Actor", "Recorded at", "Refund status", "Refund due", "Recipient", "Method", "Reference", "Receipt reconciliation", "Changes"];
    const csv = toCsv(headers, rows.map(r => [r.type, r.invoiceNumber, r.invoiceDate, r.registration, r.creditNumber, r.creditDate, r.date, r.amount, r.net, r.vat, r.reason, r.actor, r.recordedAt, r.refundState, r.refundDue, r.recipient, r.method, r.reference, r.reconciliation, r.type === "correction" ? correctionChanges(r.originalDocument).map(c => `${c.section} ${c.field}: ${c.before} -> ${c.after}`).join("; ") : ""].map(value => typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value)));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = window.document.createElement("a"); a.href = url; a.download = "cancelled-invoices-history.csv"; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="space-y-5">
    <div><h1 className="text-3xl font-bold">Cancelled Invoices &amp; Accounting History</h1><p className="text-slate-600 mt-2">Cancellations, refunds and corrections. Permanent full credits, externally confirmed refunds (including historical deposit refunds) and audited corrections to issued sales and purchases with before/after evidence. No user, including an admin, can edit or delete these records.</p></div>
    <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">Credits reverse sales/VAT on their own date. Refunds settle reconciled receipts only — recording one does not transfer money or reverse VAT again. Deleted stock remains visible here. Database-owner access is outside application permissions.</p>
    <div className="flex flex-wrap items-end gap-3">
      <div><Label htmlFor="history-from">From event date</Label><Input id="history-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
      <div><Label htmlFor="history-to">To event date</Label><Input id="history-to" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
      <div><Label htmlFor="history-type">Event type</Label><select id="history-type" className="block border rounded-md p-2" value={type} onChange={e => setType(e.target.value)}><option value="all">All events</option><option value="credit">Full cancellation credits</option><option value="refund">Sale refunds</option><option value="deposit_refund">Deposit refunds</option><option value="correction">Corrections</option><option value="review">Original document reviews</option></select></div>
      <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>Export filtered CSV</Button>
    </div>
    {query.isLoading && <p>Loading retained history…</p>}
    {query.error && <p role="alert" className="text-red-700">{accountingError(query.error)}</p>}
    {!query.isLoading && !query.error && rows.length === 0 && <p className="border rounded-md p-6">No credits, refunds or corrections match these filters. Legacy sales without verified issuance figures require accounting review before cancellation.</p>}
    {!!rows.length && <div className="border rounded-lg overflow-x-auto"><Table>
      <TableHeader><TableRow>{["Event / date", "Original / credit", "Vehicle", "Amount / VAT", "Reason / approval", "Refund status", "Evidence"].map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map(r => <TableRow key={r.id}>
        <TableCell>{r.type === "correction" ? <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800">correction</span> : r.type.replaceAll("_", " ")}<br />{r.date}<br /><span className="text-xs text-slate-500">Recorded {r.recordedAt}</span></TableCell>
        <TableCell><button className="underline" onClick={() => openDocument(r)}>{r.invoiceNumber || "Deposit record"}</button><br />{r.invoiceDate}<br />{r.creditNumber && <><button className="underline" onClick={() => openDocument(r)}>{r.creditNumber}</button><br />{r.creditDate}</>}</TableCell>
        <TableCell>{r.registration}</TableCell>
        <TableCell className="whitespace-nowrap">{r.type === "credit" && <div className="text-xs text-slate-500">Original {money(-r.amount)}<br />Net {money(-r.net)} · VAT {money(-r.vat)}</div>}{money(r.amount)}{r.type === "credit" && <><br />Net {money(r.net)}<br />VAT {money(r.vat)}</>}</TableCell>
        <TableCell className="max-w-xs">{r.reason}<br /><span className="text-xs">{r.actor}</span></TableCell>
        <TableCell>{r.type === "correction" ? <span className="text-xs text-slate-500">Not applicable</span> : <>{r.refundState}<br />Due {money(r.refundDue)}</>}{r.type === "credit" && r.canRefund && r.refundDue > 0 && <Button className="mt-2" size="sm" variant="outline" onClick={() => { setSelected(r); setAmount(""); setRefundReason(""); setDate(new Date().toISOString().slice(0, 10)); setRecipient(r.recipient); setMethod(""); setReference(""); setRequestKey(crypto.randomUUID()); setError(""); }}>Confirm external refund</Button>}{r.returnedVehicleId && (r.returnedVehicleAvailable ? <Link className="block underline" href={`/vehicles/${r.returnedVehicleId}`}>Returned stock record</Link> : <span className="block text-xs">Returned stock archived/deleted — history retained</span>)}{(r.type === "credit" || r.type === "refund") && <Button variant="outline" size="sm" className="mt-2" onClick={() => setHistoryVehicleId(r.vehicleId)}>View linked history</Button>}</TableCell>
        <TableCell className="max-w-xs">{r.recipient}<br />{r.method} {r.reference}<br />{r.reconciliation}{r.type === "refund" && <Button className="mt-2" variant="outline" size="sm" onClick={() => downloadRefundReceipt(r)}>Download refund receipt</Button>}</TableCell>
      </TableRow>)}</TableBody>
    </Table></div>}
    {document?.type === "correction" && <Card><CardHeader><CardTitle>Correction evidence {document.invoiceNumber} — {document.registration}</CardTitle></CardHeader><CardContent className="space-y-3">
      <p>{document.reason}. Recorded by {document.actor} at {document.recordedAt}. The original issued documents are retained unchanged.</p>
      {(() => { const ch = correctionChanges(document.originalDocument); return ch.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Record</TableHead><TableHead>Field</TableHead><TableHead>Before</TableHead><TableHead>After</TableHead></TableRow></TableHeader><TableBody>{ch.map((c, i) => <TableRow key={i}><TableCell>{c.section}</TableCell><TableCell>{c.field}</TableCell><TableCell className="break-all text-red-800">{c.before}</TableCell><TableCell className="break-all text-emerald-800">{c.after}</TableCell></TableRow>)}</TableBody></Table></div> : <p>No field differences found in the snapshot.</p>; })()}
      <details><summary className="cursor-pointer text-sm">Raw snapshot</summary><pre className="text-xs whitespace-pre-wrap break-all bg-slate-50 p-3">{(() => { try { return JSON.stringify(JSON.parse(document.originalDocument), null, 2); } catch { return document.originalDocument; } })()}</pre></details>
      <Button variant="outline" onClick={() => setDocument(null)}>Close correction evidence</Button>
    </CardContent></Card>}
    {document && document.type !== "correction" && <Card><CardHeader><CardTitle>{document.type === "review" ? "Permanent original-document review" : `Retained original and linked credit ${document.creditNumber}`}</CardTitle></CardHeader><CardContent className="space-y-3">
      {document.type === "review" && <p>Evidence: {document.reference}. Review notes: {document.reconciliation}. This approval is not a sale, credit or refund posting.</p>}
      <p>Original {document.invoiceNumber} — {document.invoiceDate}. Credit {document.creditNumber} — {document.creditDate}. {document.reason}</p>
      {document.type === "credit" && <p>Original gross {money(-document.amount)}, net {money(-document.net)}, VAT {money(-document.vat)}. Full credit gross {money(document.amount)}, VAT {money(document.vat)}.</p>}
      <p>Approved/recorded by {document.actor} at {document.recordedAt}.</p>
      <pre className="text-xs whitespace-pre-wrap break-all bg-slate-50 p-3">{JSON.stringify(JSON.parse(document.originalDocument), null, 2)}</pre>
      <Button variant="outline" onClick={() => setDocument(null)}>Close retained document</Button>
    </CardContent></Card>}
    {historyVehicleId !== null && <section><Button variant="outline" onClick={() => setHistoryVehicleId(null)}>Close linked history</Button><VehicleSaleHistory vehicleId={historyVehicleId} /></section>}
    {savedRefund && <Card><CardContent className="pt-6 space-y-3"><p role="status">Refund of {money(savedRefund.amount)} dated {savedRefund.date} recorded permanently. Your refund receipt is ready.</p><Button onClick={() => downloadRefundReceipt(savedRefund)}>Download refund receipt PDF</Button></CardContent></Card>}
    {selected && <Card><CardHeader><CardTitle>Confirm refund already paid outside the app</CardTitle></CardHeader><CardContent>
      <form className="space-y-3 max-w-xl" onSubmit={async e => {
        e.preventDefault(); setError("");
        try {
          const saved = await mutation.mutateAsync({ id: selected.creditId!, data: { amount: Number(amount), paymentDate: date, recipient, method, reference, requestKey, reason: refundReason.trim() } });
          setSavedRefund(saved);
          setSelected(null); await qc.invalidateQueries();
        } catch (err) { setError(accountingError(err)); }
      }}>
        <p>{selected.creditNumber}: up to {money(selected.refundDue)} remains due. This is a permanent confirmation, not a payment instruction.</p>
        <p>Completing the full refund automatically restores the vehicle to internal stock under a linked record. It will NOT be published on the showroom website.</p>
        <Label htmlFor="refund-reason">Reason for refund (permanent)</Label><Input id="refund-reason" required maxLength={2000} value={refundReason} onChange={e => setRefundReason(e.target.value)} />
        <Button type="button" variant="outline" onClick={() => setAmount(selected.refundDue.toFixed(2))}>Refund full remaining amount ({money(selected.refundDue)})</Button>
        <Label htmlFor="refund-amount">Actual amount paid (£)</Label><Input id="refund-amount" type="number" min=".01" max={selected.refundDue} step=".01" required value={amount} onChange={e => setAmount(e.target.value)} />
        <Label htmlFor="refund-date">Actual payment date</Label><Input id="refund-date" type="date" required min={selected.date} max={new Date().toISOString().slice(0, 10)} value={date} onChange={e => setDate(e.target.value)} />
        <Label htmlFor="refund-recipient">Recipient</Label><Input id="refund-recipient" required value={recipient} onChange={e => setRecipient(e.target.value)} />
        <Label htmlFor="refund-method">Payment method</Label><Input id="refund-method" required value={method} onChange={e => setMethod(e.target.value)} />
        <Label htmlFor="refund-reference">Unique bank/payment reference</Label><Input id="refund-reference" required value={reference} onChange={e => setReference(e.target.value)} />
        <label className="flex gap-2 text-sm"><input type="checkbox" required />I confirm this payment actually occurred and has not been recorded before. No automatic transfer will be made.</label>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <div className="flex gap-2"><Button type="submit" disabled={mutation.isPending}>Record paid refund</Button><Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setSelected(null)}>Back</Button></div>
      </form>
    </CardContent></Card>}
  </div>;
}
