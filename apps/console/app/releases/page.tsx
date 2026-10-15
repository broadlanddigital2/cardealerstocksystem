import { requireAdmin } from "@/lib/auth";
import { listDealers } from "@/lib/dealers";
import { listReleases, releaseCommitUrl, shortRelease } from "@/lib/releases";
import { Shell } from "@/components/Shell";
import { ReleaseButton } from "@/components/ReleaseButton";

export const dynamic = "force-dynamic";

const RUN: Record<string, { label: string; cls: string }> = {
  running: { label: "In progress", cls: "bg-amber-100 text-amber-800" },
  done: { label: "Done", cls: "bg-green-100 text-green-800" },
  failed: { label: "Some failed", cls: "bg-red-100 text-red-800" },
  stopped: { label: "Stopped at pilots", cls: "bg-red-100 text-red-800" },
};

const PART: Record<string, { icon: string; cls: string }> = {
  waiting: { icon: "○", cls: "text-slate-400" },
  running: { icon: "…", cls: "text-amber-700" },
  done: { icon: "✓", cls: "text-green-700" },
  skipped: { icon: "–", cls: "text-slate-400" },
  failed: { icon: "✗", cls: "text-red-700" },
};

export default async function ReleasesPage() {
  const admin = await requireAdmin();
  const [releases, dealers] = await Promise.all([listReleases(), listDealers()]);
  const name = new Map(dealers.map((d) => [d.id, d.name]));
  const live = dealers.filter((d) => d.status === "active");
  const versions = new Map<string, number>();
  for (const d of live) versions.set(shortRelease(d.release), (versions.get(shortRelease(d.release)) ?? 0) + 1);
  const running = releases.some((r) => r.status === "running");
  const target = process.env.CONSOLE_TARGET === "dev" ? "develop" : "main";

  return (
    <Shell admin={admin}>
      {running && <meta httpEquiv="refresh" content="10" />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Releases</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Every change merged to <span className="font-mono">{target}</span> goes out to all {live.length} live{" "}
            {live.length === 1 ? "dealer" : "dealers"} automatically: pilot dealers first, then everyone else, one at a
            time. Each dealer keeps its own database and site; only the code is the same.
          </p>
        </div>
        <ReleaseButton
          label="Release latest to all dealers"
          confirmText="Release the latest version to every live dealer now? Dealers already on it are skipped."
        />
      </div>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Dealers by version</h2>
        {live.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No live dealers yet.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {[...versions.entries()].map(([v, n]) => (
              <li key={v} className="rounded-full bg-slate-100 px-3 py-1">
                <span className="font-mono">{v}</span> · {n} {n === 1 ? "dealer" : "dealers"}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 space-y-4">
        {releases.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
            No releases yet. The next change merged to <span className="font-mono">{target}</span> starts one.
          </p>
        )}
        {releases.map((r) => {
          const badge = RUN[r.status] ?? RUN.running!;
          const url = releaseCommitUrl(r.release);
          return (
            <article key={r.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                <span className="font-medium">{r.title ?? "Release"}</span>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="font-mono text-xs text-blue-700 hover:underline">
                    {shortRelease(r.release)}
                  </a>
                ) : (
                  <span className="font-mono text-xs text-slate-500">{shortRelease(r.release)}</span>
                )}
                <span className="ml-auto text-xs text-slate-500">
                  {r.createdAt.toLocaleString("en-GB", { timeZone: "Europe/London" })} · {r.startedBy}
                  {r.githubRunUrl && (
                    <>
                      {" · "}
                      <a href={r.githubRunUrl} target="_blank" rel="noreferrer" className="hover:underline">
                        job log
                      </a>
                    </>
                  )}
                </span>
              </div>
              {r.message && <p className="mt-2 text-sm text-slate-600">{r.message}</p>}
              {r.dealers.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {r.dealers.map((p) => {
                    const st = PART[p.status] ?? PART.waiting!;
                    return (
                      <li key={p.dealerId} className="flex gap-3">
                        <span className={`w-4 font-bold ${st.cls}`}>{st.icon}</span>
                        <a href={`/dealers/${p.dealerId}`} className="hover:underline">
                          {name.get(p.dealerId) ?? `Dealer ${p.dealerId}`}
                        </a>
                        {p.wave === 1 && <span className="rounded-full bg-sky-100 px-2 text-[11px] text-sky-800">pilot</span>}
                        {p.message && (
                          <span className={`text-xs ${p.status === "failed" ? "text-red-700" : "text-slate-500"}`}>{p.message}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          );
        })}
      </section>
    </Shell>
  );
}
