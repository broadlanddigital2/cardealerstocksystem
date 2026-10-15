import type { ReactNode } from "react";
import { signOutAction } from "../../app/actions";

export function Shell({ admin, children }: { admin: string; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <nav className="flex items-center gap-5">
            <a href="/" className="font-bold">Stock Book Console</a>
            <a href="/" className="text-sm text-slate-600 hover:text-slate-900">Dealers</a>
            <a href="/modules" className="text-sm text-slate-600 hover:text-slate-900">Modules</a>
            <a href="/releases" className="text-sm text-slate-600 hover:text-slate-900">Releases</a>
          </nav>
          <div className="flex items-center gap-4 text-sm text-slate-500">
            <span>{admin}</span>
            <form action={signOutAction}>
              <button className="hover:text-slate-900 hover:underline">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

const STATUS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  provisioning: "bg-amber-100 text-amber-800",
  active: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  suspended: "bg-slate-200 text-slate-600",
};

const LABEL: Record<string, string> = {
  draft: "Not set up yet",
  provisioning: "Setting up",
  active: "Live",
  failed: "Setup failed",
  suspended: "Suspended",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[status] ?? STATUS.draft}`}>
      {LABEL[status] ?? status}
    </span>
  );
}
