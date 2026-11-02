import type { Dealer } from "@/db/client";
import { GRACE_DAYS, exportFileName } from "@/lib/removal";
import { DeleteNowForm, RemoveDealerForm, RestoreDealerButton } from "./RemovalForms";

const fmt = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : "");

export function RemovalPanel({ dealer, jobRunning }: { dealer: Dealer; jobRunning: boolean }) {
  if (dealer.status === "deleted") return null;

  if (dealer.status === "suspended") {
    const keys = dealer.exportKeys ?? [];
    return (
      <section id="removal" className="mb-8 rounded-xl border border-red-200 bg-red-50 p-6">
        <h2 className="font-semibold text-red-900">Removed</h2>
        <p className="mt-1 text-sm text-red-900">
          Removed on {fmt(dealer.removalRequestedAt)}. Their site is closed. Everything (site, web addresses, files, database
          {dealer.removeEmail ? ", email" : ""} and the export below) is <strong>permanently deleted on {fmt(dealer.deleteAfter)}</strong>.
          {!dealer.removeEmail && dealer.trekmailDomainId && " Their email is kept running."}
        </p>

        <div className="mt-4 rounded-lg border border-red-200 bg-white p-4">
          <h3 className="text-sm font-semibold">Their data</h3>
          {keys.length && dealer.exportReadyAt ? (
            <>
              <p className="mt-1 text-xs text-slate-500">
                Give these to the dealer before {fmt(dealer.deleteAfter)}. The data download has one spreadsheet (CSV) per table;
                the files downloads hold their photos and documents.
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {keys.map((k) => (
                  <li key={k}>
                    <a href={`/dealers/${dealer.id}/export?key=${encodeURIComponent(k)}`} className="font-mono text-blue-700 hover:underline">
                      {exportFileName(k)}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-500">
              {jobRunning ? "Being prepared (see the steps above). This page updates by itself." : "Not ready yet, or the export failed (see the steps above)."}
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-start gap-6">
          <RestoreDealerButton dealerId={dealer.id} />
          <div>
            <p className="mb-1 text-xs text-red-900">Don&apos;t want to wait {GRACE_DAYS} days? This can&apos;t be undone.</p>
            <DeleteNowForm dealerId={dealer.id} slug={dealer.slug} />
          </div>
        </div>
      </section>
    );
  }

  const draft = dealer.status === "draft";
  return (
    <section id="removal" className="mt-8 rounded-xl border border-red-200 bg-white p-6">
      <h2 className="font-semibold text-red-800">{draft ? "Delete this dealer" : "Remove this dealer"}</h2>
      <p className="mt-1 text-sm text-slate-600">
        {draft
          ? "Nothing has been set up for this dealer yet, so this just deletes the record."
          : `Closes their site straight away and prepares a download of their data for them. ${GRACE_DAYS} days later their site, web addresses, files and database are permanently deleted (you can undo until then, or delete sooner).`}
      </p>
      <RemoveDealerForm dealerId={dealer.id} slug={dealer.slug} draft={draft} emailDomain={dealer.trekmailDomainId ? dealer.emailDomain : null} />
    </section>
  );
}
