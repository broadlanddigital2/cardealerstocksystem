import { Link } from "wouter";
import { useGetVehicleSaleHistory, getGetVehicleSaleHistoryQueryKey } from "@workspace/api-client-react";
import { useAccess } from "@/App";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { accountingError } from "./SaleCancellation";

const titles = { sale: "Sale issued", credit: "Full credit", refund: "Refund paid", returned_stock: "Returned to internal stock", correction: "Audited correction", review: "Original documents reviewed by admin" };
const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export default function VehicleSaleHistory({ vehicleId }: { vehicleId: number }) {
  const { isAdmin } = useAccess();
  const query = useGetVehicleSaleHistory(vehicleId, { query: {
    queryKey: getGetVehicleSaleHistoryQueryKey(vehicleId), enabled: isAdmin, refetchInterval: 30000,
  } });
  if (!isAdmin) return null;
  return <Card className="my-4">
    <CardHeader><CardTitle>Sale &amp; refund history</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Read-only retained history across linked stock records, including later resales. Deleting stock does not cancel a sale or remove this history. Sales show original issuance figures; audited corrections explain later changes. Events use their effective dates; corrections use the date recorded.</p>
      {query.isLoading && <p role="status">Loading history…</p>}
      {query.error && <div role="alert"><p>{accountingError(query.error)}</p><Button variant="outline" onClick={() => query.refetch()}>Retry</Button></div>}
      {query.data?.length === 0 && <p>No retained sale or return events for this vehicle.</p>}
      {!query.error && <ol className="space-y-4 border-l pl-4">
        {query.data?.map(event => <li key={event.id} className="space-y-1 text-sm">
          <p className="font-semibold">{event.date || "Date not recorded"} — {titles[event.type]}{event.amount !== undefined && ` · ${money(event.amount)}`}</p>
          <p>{event.documentNumber}{event.documentNumber && " · "}{event.vehicleAvailable
            ? <Link className="underline" href={`/vehicles/${event.vehicleId}`}>{event.stockLabel}{event.vehicleId === vehicleId ? " (this record)" : ""}</Link>
            : <span>{event.stockLabel} — archived/deleted stock; history retained</span>}</p>
          <p className="whitespace-pre-wrap break-words">{event.reason}</p>
          {(event.type === "correction" || event.type === "review") && <div>
            {event.previousAmount !== undefined && event.correctedAmount !== undefined && <p>Sale gross before: {money(event.previousAmount)} → after: {money(event.correctedAmount)}</p>}
            {event.originalDocument && <details><summary className="cursor-pointer underline">View retained correction evidence</summary><pre className="mt-2 whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">{JSON.stringify(JSON.parse(event.originalDocument), null, 2)}</pre></details>}
          </div>}
          {event.type === "refund" && <p className="break-words">{event.recipient} · {event.method} · Reference: {event.reference}</p>}
          {event.recordedAt && <p className="text-xs text-muted-foreground break-words">Recorded {event.recordedAt}{event.actor && ` by ${event.actor}`}</p>}
        </li>)}
      </ol>}
    </CardContent>
  </Card>;
}
