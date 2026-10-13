import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dealerHistory, getDealer } from "@/lib/dealers";
import { Shell, StatusBadge } from "@/components/Shell";
import { DealerForm } from "@/components/DealerForm";
import { updateDealerAction } from "../../actions";

export const dynamic = "force-dynamic";

const ACTIONS: Record<string, string> = {
  "dealer.created": "Added",
  "dealer.updated": "Changed",
};

export default async function DealerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const admin = await requireAdmin();
  const id = Number((await params).id);
  const dealer = Number.isInteger(id) ? await getDealer(id) : null;
  if (!dealer) notFound();
  const saved = (await searchParams).saved === "1";
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

      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Set up</h2>
        <p className="mt-1 text-sm text-slate-500">
          {dealer.status === "draft"
            ? "Not set up yet. One-click setup of this dealer's database, files, site and email arrives in the next step of the console."
            : "This dealer's site is set up."}
        </p>
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
