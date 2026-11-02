import type { DealerDomain } from "@/db/client";
import { cnameTarget } from "@/lib/domains";
import { applyDomainDnsAction, checkDomainAction, checkDomainsAction, removeDomainAction } from "../../app/actions";
import { canEditZone, findZone } from "@/lib/cloudflare-dns";
import { ApplyDnsButton } from "./ApplyDnsButton";
import { pollDomainsAction } from "../../app/actions";
import { buildInstructions } from "@/lib/dns-instructions";
import { DnsInstructionsBox } from "./DnsInstructionsBox";
import { LiveDnsWatch } from "./LiveDnsWatch";
import { CheckButton } from "./CheckButton";
import { AddDomainForm } from "./AddDomainForm";
import { CopyButton } from "./CopyButton";

const KIND: Record<string, string> = { staff: "Staff", showroom: "Showroom" };

export async function DomainsPanel({
  dealerId,
  domains,
  contactEmail,
  watch,
}: {
  dealerId: number;
  domains: DealerDomain[];
  contactEmail: string;
  watch?: { until: number; notice: string | null } | null;
}) {
  // Addresses whose DNS is in our Cloudflare account can have their record added for them.
  const editable = new Map<number, string>();
  for (const d of domains) {
    if (d.status === "active") continue;
    const zone = await findZone(d.hostname);
    if (zone && (await canEditZone(zone.id))) editable.set(d.id, zone.name);
  }
  return (
    <section id="domains" className="mb-8 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold">Their own addresses</h2>
        {domains.length > 0 && (
          <form action={checkDomainsAction}>
            <input type="hidden" name="id" value={dealerId} />
            <CheckButton>Check all</CheckButton>
          </form>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Add the dealer&apos;s own web address. Then they (or their web person) add the DNS record shown at their domain
        provider. The address works once it shows <strong>Live</strong>, usually within an hour of the record being added.
        Use a subdomain like <span className="font-mono">www.</span> or <span className="font-mono">stock.</span>: most
        providers can&apos;t point the bare domain at another address.
      </p>
      {watch && (
        <LiveDnsWatch
          dealerId={dealerId}
          until={watch.until}
          done={domains.every((d) => d.status === "active")}
          notice={watch.notice}
          poll={pollDomainsAction}
        />
      )}

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
                {d.status !== "active" && (
                  <form action={checkDomainAction} className="ml-auto">
                    <input type="hidden" name="id" value={dealerId} />
                    <input type="hidden" name="domainId" value={d.id} />
                    <CheckButton />
                  </form>
                )}
                <form action={removeDomainAction} className={d.status === "active" ? "ml-auto" : ""}>
                  <input type="hidden" name="id" value={dealerId} />
                  <input type="hidden" name="domainId" value={d.id} />
                  <button className="text-xs text-red-700 hover:underline">Remove</button>
                </form>
              </div>
              {d.status !== "active" && (
                <div className="mt-3 overflow-x-auto">
                  {editable.has(d.id) && (
                    <div className="mb-2 rounded-md bg-orange-50 p-3">
                      <p className="mb-2 text-xs text-orange-900">
                        {d.hostname} is in your Cloudflare account ({editable.get(d.id)}), so the console can add the record.
                      </p>
                      <ApplyDnsButton
                        action={applyDomainDnsAction}
                        fields={{ id: dealerId, domainId: d.id }}
                        label="Add the record in Cloudflare"
                        confirmText={`Add the DNS record for ${d.hostname} in Cloudflare?\n\nIf something else already uses that name (e.g. a website A record) it's left alone and you'll be told.`}
                      />
                    </div>
                  )}
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
                          <td className="py-1 pr-3">
                            <span className="flex items-center">{r.type}<CopyButton value={r.type} label="type" /></span>
                          </td>
                          <td className="py-1 pr-3">
                            <span className="flex items-center justify-between"><span className="break-all">{r.name}</span><CopyButton value={r.name} label="name" /></span>
                          </td>
                          <td className="py-1">
                            <span className="flex items-center justify-between"><span className="break-all">{r.value}</span><CopyButton value={r.value} label="value" /></span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {d.status !== "active" && (
                <div className="mt-2">
                  <DnsInstructionsBox
                    dealerId={dealerId}
                    kind="web"
                    domainId={d.id}
                    defaultTo={contactEmail}
                    text={
                      buildInstructions({
                        dealerName: "",
                        domain: d.hostname.split(".").length > 2 ? d.hostname.split(".").slice(1).join(".") : d.hostname,
                        purpose: "web",
                        address: d.hostname,
                        records: d.records.length ? d.records : [{ type: "CNAME", name: d.hostname, value: cnameTarget() }],
                      }).text
                    }
                  />
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
