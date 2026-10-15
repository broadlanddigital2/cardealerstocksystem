"use client";

import { useFormStatus } from "react-dom";
import type { ModuleTier } from "@workspace/modules";
import { setModuleEnabledAction, setModuleTierAction } from "../../app/actions";

function Busy() {
  const { pending } = useFormStatus();
  return pending ? <span className="text-xs text-slate-400">Saving…</span> : null;
}

/** Core / Premium choice for one module; saves straight away. */
export function TierSwitch({ moduleKey, name, tier, dealers }: { moduleKey: string; name: string; tier: ModuleTier; dealers: number }) {
  const next: ModuleTier = tier === "core" ? "premium" : "core";
  const message =
    next === "premium"
      ? `Make ${name} premium?\n\nDealers who have it now keep it. New dealers won't get it unless you switch it on for them.`
      : `Make ${name} core?\n\nDealers keep what they have now. New dealers get it automatically.`;
  return (
    <form
      action={setModuleTierAction}
      onSubmit={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="key" value={moduleKey} />
      <input type="hidden" name="tier" value={next} />
      <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-xs font-medium" role="group" aria-label={`${name} tier`}>
        {(["core", "premium"] as const).map((t) =>
          t === tier ? (
            <span
              key={t}
              aria-current="true"
              className={`px-3 py-1.5 ${t === "premium" ? "bg-violet-600 text-white" : "bg-slate-800 text-white"}`}
            >
              {t === "core" ? "Core" : "Premium"}
            </span>
          ) : (
            <button key={t} type="submit" className="bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50">
              {t === "core" ? "Core" : "Premium"}
            </button>
          ),
        )}
      </div>
      <span className="sr-only">{dealers} dealers have it</span>
      <Busy />
    </form>
  );
}

/** On / off for every dealer; saves straight away. */
export function EnabledSwitch({ moduleKey, name, enabled, dealers }: { moduleKey: string; name: string; enabled: boolean; dealers: number }) {
  const message = enabled
    ? `Switch ${name} off for every dealer?\n\nIt disappears from ${dealers} ${dealers === 1 ? "dealer's site" : "dealers' sites"} straight away. Each dealer's own setting is kept for when you switch it back on.`
    : `Switch ${name} back on?\n\nDealers who had it get it back straight away.`;
  return (
    <form
      action={setModuleEnabledAction}
      onSubmit={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="key" value={moduleKey} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <button
        type="submit"
        role="switch"
        aria-checked={enabled}
        aria-label={`${name} on for everyone`}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${enabled ? "bg-green-600" : "bg-slate-300"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : ""}`} />
      </button>
      <span className={`w-7 text-xs font-medium ${enabled ? "text-green-700" : "text-slate-500"}`}>{enabled ? "On" : "Off"}</span>
      <Busy />
    </form>
  );
}
