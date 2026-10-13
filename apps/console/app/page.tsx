import { requireAdmin } from "@/lib/auth";
import { listDealers } from "@/lib/dealers";
import { Shell, StatusBadge } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function DealersPage() {
  const admin = await requireAdmin();
  const dealers = await listDealers();
  return (
    <Shell admin={admin}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dealers</h1>
        <a href="/dealers/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Add dealer
        </a>
      </div>
      {dealers.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          No dealers yet. Add the first one.
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Dealer</th>
                <th className="px-4 py-3 font-medium">Short id</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Modules</th>
              </tr>
            </thead>
            <tbody>
              {dealers.map((d) => (
                <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <a href={`/dealers/${d.id}`} className="font-medium hover:underline">{d.name}</a>
                    {d.webDomain && <div className="text-xs text-slate-500">{d.webDomain}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{d.slug}</td>
                  <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                  <td className="px-4 py-3 text-slate-500">{d.modules.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
