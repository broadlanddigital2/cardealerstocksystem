import type { ReactNode } from "react";
import type { Dealer } from "@/db/client";
import {
  emailDomainFor,
  forwardingAddress,
  getDnsRequirements,
  getEmailDomain,
  listForwarding,
  listMailboxes,
  trekmailConfigured,
  type TmCheck,
  type TmDnsRecord,
  type TmDomain,
  type TmForwarding,
  type TmMailbox,
} from "@/lib/trekmail";
import { applyEmailDnsAction, recheckEmailDnsAction, removeForwardingAction } from "../../app/actions";
import { canEditZone, findZone } from "@/lib/cloudflare-dns";
import { ApplyDnsButton } from "./ApplyDnsButton";
import { CheckButton } from "./CheckButton";
import { CopyButton } from "./CopyButton";
import { AddForwardingForm, AddMailboxForm, MailboxActions, SetUpEmailForm } from "./EmailForms";

const CHECK_LABEL: Record<string, string> = {
  mx_primary: "Incoming mail (MX)",
  spf_main: "Sending permission (SPF)",
  dkim_primary: "Signing (DKIM)",
  dmarc_main: "Spoofing policy (DMARC)",
  tlsrpt: "Encryption reports",
  mta_sts_txt: "Encrypted delivery (MTA-STS)",
  mta_sts_cname: "Encrypted delivery host",
  autoconfig_cname: "Mail app auto-setup",
  autodiscover_cname: "Outlook auto-setup",
  smtp_alias: "Custom SMTP address",
};

function Badge({ ok, warn, children }: { ok: boolean; warn?: boolean; children: ReactNode }) {
  const cls = ok ? "bg-green-100 text-green-800" : warn ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export async function EmailPanel({ dealer }: { dealer: Dealer }) {
  const suggested = emailDomainFor(dealer) ?? "";
  if (!trekmailConfigured()) {
    return (
      <section id="email" className="mb-8 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Email</h2>
        <p className="mt-1 text-sm text-slate-500">
          Email isn&apos;t connected yet: add the TrekMail API token as the GitHub secret TREKMAIL_API_TOKEN and redeploy the console.
        </p>
      </section>
    );
  }

  if (!dealer.trekmailDomainId) {
    return (
      <section id="email" className="mb-8 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Email</h2>
        <p className="mt-1 text-sm text-slate-500">
          Mailboxes on the dealer&apos;s own domain (e.g. sales@{suggested || "theirdomain.co.uk"}), hosted by TrekMail. Setting
          up adds the domain and shows the DNS records the dealer needs to add.
        </p>
        <SetUpEmailForm dealerId={dealer.id} suggested={suggested} />
      </section>
    );
  }

  let domain: TmDomain | null = null;
  let records: TmDnsRecord[] = [];
  let checks: TmCheck[] = [];
  let mailboxes: TmMailbox[] = [];
  let forwarding: TmForwarding[] = [];
  let problem: string | null = null;
  try {
    [domain, { required_records: records, checks }, mailboxes, forwarding] = await Promise.all([
      getEmailDomain(dealer.trekmailDomainId),
      getDnsRequirements(dealer.trekmailDomainId),
      listMailboxes(dealer.trekmailDomainId),
      listForwarding(dealer.trekmailDomainId).catch(() => []),
    ]);
  } catch (err) {
    problem = err instanceof Error ? err.message : "Couldn't reach TrekMail.";
  }
  const name = dealer.emailDomain ?? domain?.domain ?? suggested;
  const zone = name ? await findZone(name) : null;
  const zoneEditable = zone ? await canEditZone(zone.id) : false;
  const active = domain?.status === "active";
  const failing = checks.filter((c) => c.status === "fail" && c.check_key !== "smtp_alias");

  return (
    <section id="email" className="mb-8 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Email</h2>
        <span className="font-mono text-sm">{name}</span>
        {domain && (
          <Badge ok={active && domain.dns_health === "ok"} warn={active}>
            {active ? (domain.dns_health === "ok" ? "Working" : "Working, some DNS records to tidy") : "Waiting for DNS"}
          </Badge>
        )}
        <form action={recheckEmailDnsAction} className="ml-auto">
          <input type="hidden" name="id" value={dealer.id} />
          <CheckButton />
        </form>
      </div>
      {problem && <p className="mt-2 text-sm text-red-600">{problem}</p>}

      {records.length > 0 && (
        <details className="mt-4 rounded-lg border border-slate-200" open={!active || failing.length > 0}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            DNS records for {name}
            {failing.length > 0 ? ` (${failing.length} still to add or fix)` : " (all in place)"}
          </summary>
          <div className="space-y-3 border-t border-slate-200 p-4">
            {zoneEditable ? (
              <div className="rounded-md bg-orange-50 p-3">
                <p className="mb-2 text-xs text-orange-900">
                  {name}&apos;s DNS is in your Cloudflare account ({zone!.name}), so the console can add these for you.
                </p>
                <ApplyDnsButton
                  action={applyEmailDnsAction}
                  fields={{ id: dealer.id }}
                  confirmText={`Add these records to ${zone!.name} in Cloudflare?\n\nIncoming mail for ${name} moves to TrekMail: any existing MX records and SPF/DKIM/DMARC records for it are replaced. Other records are left alone.`}
                />
              </div>
            ) : zone ? (
              <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">
                {name} is in your Cloudflare account ({zone.name}), but the console&apos;s Cloudflare token can&apos;t edit it. Give the token
                Zone → DNS → Edit for that zone (or all zones) and this can be done for you.
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Add these where {name}&apos;s DNS is managed (their domain provider). Replace any existing MX records and any
                existing SPF record (the TXT starting v=spf1) rather than adding a second one.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Type</th>
                    <th className="py-1 pr-3 font-medium">Name</th>
                    <th className="py-1 pr-3 font-medium">Value</th>
                    <th className="py-1 font-medium">Priority</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {records.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100 align-top">
                      <td className="py-1 pr-3">{r.type}</td>
                      <td className="py-1 pr-3">
                        <span className="flex items-center justify-between gap-2">
                          <span className="break-all">{r.name}</span>
                          <CopyButton value={r.name} label="name" />
                        </span>
                      </td>
                      <td className="py-1 pr-3">
                        <span className="flex items-center justify-between gap-2">
                          <span className="break-all">{r.value}</span>
                          <CopyButton value={r.value} label="value" />
                        </span>
                      </td>
                      <td className="py-1">{r.priority ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {checks.length > 0 && (
              <ul className="grid gap-1 text-xs sm:grid-cols-2">
                {checks
                  .filter((c) => c.status !== "unknown")
                  .map((c) => (
                    <li key={c.check_key} className="flex gap-2">
                      <span className={c.status === "pass" ? "text-green-700" : c.status === "warn" ? "text-amber-700" : "text-red-700"}>
                        {c.status === "pass" ? "✓" : c.status === "warn" ? "!" : "✗"}
                      </span>
                      <span>
                        {CHECK_LABEL[c.check_key] ?? c.check_key}
                        {c.status !== "pass" && c.hint && <span className="block text-slate-500">{c.hint}</span>}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </details>
      )}

      <div className="mt-6">
        <h3 className="text-sm font-semibold">Mailboxes ({mailboxes.length})</h3>
        {mailboxes.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {mailboxes.map((m) => (
              <li key={m.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]">
                <div className="text-sm">
                  <span className="font-mono">{m.email}</span>
                  {m.display_name && <span className="ml-2 text-slate-500">{m.display_name}</span>}
                  <span className="ml-2 text-xs text-slate-400">
                    {m.status !== "active" ? m.status : m.login_suspended ? "sign-in suspended" : ""}
                    {m.forwarding_enabled ? " · forwarding on" : ""}
                  </span>
                </div>
                <MailboxActions dealerId={dealer.id} mailboxId={m.id} address={m.email} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <AddMailboxForm dealerId={dealer.id} domain={name} />
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold">Forwarding addresses ({forwarding.length})</h3>
        {forwarding.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {forwarding.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <span className="font-mono">{forwardingAddress(f, name)}</span>
                <span className="text-slate-400">→</span>
                <span className="text-slate-600">{f.recipients.join(", ")}</span>
                {f.is_active === false && <span className="text-xs text-slate-400">(paused)</span>}
                <form action={removeForwardingAction} className="ml-auto">
                  <input type="hidden" name="id" value={dealer.id} />
                  <input type="hidden" name="forwardingId" value={f.id} />
                  <button className="text-xs text-red-700 hover:underline">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <AddForwardingForm dealerId={dealer.id} domain={name} />
        </div>
      </div>
    </section>
  );
}
