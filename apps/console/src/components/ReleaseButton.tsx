"use client";

import { useActionState } from "react";
import { startReleaseAction, type FormState } from "../../app/actions";

/** Starts a release to every dealer, or (with dealerId) an update of one dealer. */
export function ReleaseButton({ dealerId, label, confirmText }: { dealerId?: number; label: string; confirmText: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(startReleaseAction, { error: null });
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(confirmText)) e.preventDefault();
      }}
      className="space-y-2"
    >
      {dealerId && <input type="hidden" name="id" value={dealerId} />}
      <button disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
        {pending ? "Starting…" : label}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
