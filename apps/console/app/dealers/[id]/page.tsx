import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dealerHistory, getDealer } from "@/lib/dealers";
import { Shell, StatusBadge } from "@/components/Shell";
import { DealerForm } from "@/components/DealerForm";
import { updateDealerAction } from "../../actions";
import { SetupButton } from "@/components/SetupButton";
import { SETUP_STEPS, latestSteps, siteHost } from "@/lib/setup";

export const dynamic = "force-dynamic";

const ACTIONS: Record<string, string> = {
  "dealer.created": "Added",
  "dealer.updated": "Changed",
  "dealer.setup_started": "Setup started",
  "dealer.setup_finished": "Setup finished",
  "dealer.setup_failed": "Setup failed",
};

export default async function DealerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; push?: string }>;
}) {
  const admin = await requireAdmin();
  const id = Number((await params).id);
  const dealer = Number.isInteger(id) ? await getDealer(id) : null;
  if (!dealer) notFound();
  const sp = await searchParams;
  const saved = sp.saved === "1";
  const steps = await latestSteps(dealer.id);
  const host = siteHost(dealer);
  const history = await dealerHistory(dealer.id);
  const s = (v: string | null) => v ?? "";

  return (
    <Shell admin={admin}>
      <a href="/" className="text-sm text-slate-500 hover:underline">← Dealers</a>
      <div className="mt-2 mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold">{dealer.name}</h1>
        <StatusBadge status={dealer.status} />
      </div>
      {saved && <p className="mb-6 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Saved.</p>}

      {dealer.status === "provisioning" && <meta httpEquiv="refresh" content="5" />}
      {sp.push && (
        <p className="mb-6 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Saved, but the modules couldn&apos;t be sent to the dealer&apos;s site: {sp.push}
        </p>
      )}
      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Set up</h2>
        {dealer.status === "active" && dealer.siteUrl ? (
          <p className="mt-1 text-sm text-slate-600">
            Live at{" "}
            <a href={dealer.siteUrl} className="font-medium text-blue-700 hover:underline" target="_blank" rel="noreferrer">
              {dealer.siteUrl.replace(/^https:\/\//, "")}
            </a>
            {dealer.provisionedAt && <> · set up {dealer.provisionedAt.toLocaleDateString("en-GB")}</>}. Module changes saved below go to the site straight away.
          </p>
        ) : dealer.status === "provisioning" ? (
          <p className="mt-1 text-sm text-slate-600">Setting up. This page updates every few seconds; it usually takes 5–10 minutes.</p>
        ) : (
          <p className="mt-1 text-sm text-slate-600">
            Creates this dealer&apos;s own database, file bucket and site at <span className="font-mono">{host}</span>, saves their
            details and modules, and emails {dealer.firstAdminEmail} an invitation.
          </p>
        )}

        {steps.length > 0 && (
          <ol className="mt-4 space-y-2 text-sm">
            {steps.map((st) => {
              const label = SETUP_STEPS.find((x) => x.key === st.step)?.label ?? st.step;
              const icon = st.status === "done" ? "✓" : st.status === "failed" ? "✗" : st.status === "running" ? "…" : "○";
              const colour =
                st.status === "done" ? "text-green-700" : st.status === "failed" ? "text-red-700" : st.status === "running" ? "text-amber-700" : "text-slate-400";
              return (
                <li key={st.id} className="flex gap-3">
                  <span className={`w-4 font-bold ${colour}`}>{icon}</span>
                  <span>
                    <span className={st.status === "pending" ? "text-slate-400" : ""}>{label}</span>
                    {st.message && <span className={`block text-xs ${st.status === "failed" ? "text-red-700" : "text-slate-500"}`}>{st.message}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {(dealer.status === "draft" || dealer.status === "failed") && (
          <SetupButton dealerId={dealer.id} label={dealer.status === "failed" ? "Try setup again" : "Set up this dealer"} />
        )}
      </section>

      <DealerForm
        action={updateDealerAction}
        submitLabel="Save changes"
        values={{
          id: dealer.id,
          name: dealer.name,
          slug: dealer.slug,
          slugLocked: dealer.status !== "draft",
          companyNumber: s(dealer.companyNumber),
          contactName: s(dealer.contactName),
          contactEmail: s(dealer.contactEmail),
          contactPhone: s(dealer.contactPhone),
          billingEmail: s(dealer.billingEmail),
          webDomain: s(dealer.webDomain),
          staffDomain: s(dealer.staffDomain),
          showroomDomain: s(dealer.showroomDomain),
          firstAdminEmail: dealer.firstAdminEmail,
          modules: dealer.modules,
          notes: s(dealer.notes),
        }}
      />

      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">History</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {history.map((h) => (
            <li key={h.id} className="flex gap-3">
              <span className="w-40 shrink-0 text-slate-500">{h.at.toLocaleString("en-GB", { timeZone: "Europe/London" })}</span>
              <span>
                {ACTIONS[h.action] ?? h.action} by {h.actorEmail}
                {h.action === "dealer.updated" && h.detail && typeof h.detail === "object"
                  ? `: ${Object.keys(h.detail as object).join(", ") || "no changes"}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}
