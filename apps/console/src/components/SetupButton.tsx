"use client";

import { useActionState } from "react";
import { startSetupAction, type FormState } from "../../app/actions";

export function SetupButton({ dealerId, label }: { dealerId: number; label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(startSetupAction, { error: null });
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Set up this dealer now? This creates their database, file bucket and site.")) e.preventDefault();
      }}
      className="mt-4 space-y-2"
    >
      <input type="hidden" name="id" value={dealerId} />
      <button disabled={pending} className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50">
        {pending ? "Starting…" : label}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
