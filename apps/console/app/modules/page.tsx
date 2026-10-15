import { requireAdmin } from "@/lib/auth";
import { listModuleRows } from "@/lib/catalogue";
import { Shell } from "@/components/Shell";
import { EnabledSwitch, TierSwitch } from "@/components/ModuleSwitches";

export const dynamic = "force-dynamic";

export default async function ModulesPage({ searchParams }: { searchParams: Promise<{ saved?: string; unreached?: string }> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const { rows, liveDealers } = await listModuleRows();

  return (
    <Shell admin={admin}>
      <h1 className="text-2xl font-bold">Modules</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-500">
        Settings for every dealer. <strong>Core</strong> modules are on for each dealer unless you switch them off on that
        dealer&apos;s page; <strong>Premium</strong> modules are off unless you switch them on there. Changing a tier never
        takes anything away from a dealer who has it now. <strong>On for everyone</strong> switched off hides the module
        from every dealer (for example while it&apos;s being fixed). Changes reach dealers&apos; sites straight away.
      </p>

      {sp.saved && <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Saved and sent to every dealer.</p>}
      {sp.unreached && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Saved, but these dealers&apos; sites couldn&apos;t be reached: {sp.unreached}. They get the change with the next release
          or the next time you save them.
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Module</th>
              <th className="px-4 py-3 font-medium">Core / Premium</th>
              <th className="px-4 py-3 font-medium">On for everyone</th>
              <th className="px-4 py-3 font-medium">Dealers using it</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.key} className={`border-t border-slate-100 align-top ${m.enabled ? "" : "bg-slate-50"}`}>
                <td className="px-4 py-3">
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-slate-500">{m.description}</div>
                </td>
                <td className="px-4 py-3">
                  <TierSwitch moduleKey={m.key} name={m.name} tier={m.tier} dealers={m.dealers} />
                </td>
                <td className="px-4 py-3">
                  <EnabledSwitch moduleKey={m.key} name={m.name} enabled={m.enabled} dealers={m.dealers} />
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {m.dealers} of {liveDealers}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
