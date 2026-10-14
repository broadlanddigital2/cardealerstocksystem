import type { DealerDomain } from "@/db/client";
import { cnameTarget } from "@/lib/domains";
import { checkDomainsAction, removeDomainAction } from "../../app/actions";
import { AddDomainForm } from "./AddDomainForm";

const KIND: Record<string, string> = { staff: "Staff", showroom: "Showroom" };

export function DomainsPanel({ dealerId, domains }: { dealerId: number; domains: DealerDomain[] }) {
  return (
    <section id="domains" className="mb-8 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold">Their own addresses</h2>
        {domains.length > 0 && (
          <form action={checkDomainsAction}>
            <input type="hidden" name="id" value={dealerId} />
            <button className="text-sm text-slate-600 hover:text-slate-900 hover:underline">Check now</button>
          </form>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Add the dealer&apos;s own web address. Then they (or their web person) add the DNS record shown at their domain
        provider. The address works once it shows <strong>Live</strong>, usually within an hour of the record being added.
        Use a subdomain like <span className="font-mono">www.</span> or <span className="font-mono">stock.</span>: most
        providers can&apos;t point the bare domain at another address.
      </p>

      {domains.length > 0 && (
        <ul className="mt-4 space-y-4">
          {domains.map((d) => (
            <li key={d.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm font-medium">{d.hostname}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{KIND[d.kind] ?? d.kind}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    d.status === "active" ? "bg-green-100 text-green-800" : d.status === "error" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {d.status === "active" ? "Live" : d.status === "error" ? "Problem" : "Waiting for DNS"}
                </span>
                <form action={removeDomainAction} className="ml-auto">
                  <input type="hidden" name="id" value={dealerId} />
                  <input type="hidden" name="domainId" value={d.id} />
                  <button className="text-xs text-red-700 hover:underline">Remove</button>
                </form>
              </div>
              {d.status !== "active" && (
                <div className="mt-3 overflow-x-auto">
                  <p className="text-xs text-slate-500">DNS records to add at the dealer&apos;s domain provider:</p>
                  <table className="mt-1 w-full text-xs">
                    <thead className="text-left text-slate-500">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Type</th>
                        <th className="py-1 pr-3 font-medium">Name</th>
                        <th className="py-1 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {(d.records.length ? d.records : [{ type: "CNAME", name: d.hostname, value: cnameTarget() }]).map((r, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="py-1 pr-3">{r.type}</td>
                          <td className="break-all py-1 pr-3">{r.name}</td>
                          <td className="break-all py-1">{r.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {d.message && <p className="mt-2 text-xs text-red-700">{d.message}</p>}
              {d.checkedAt && (
                <p className="mt-2 text-xs text-slate-400">
                  Checked {d.checkedAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <AddDomainForm dealerId={dealerId} />
    </section>
  );
}
