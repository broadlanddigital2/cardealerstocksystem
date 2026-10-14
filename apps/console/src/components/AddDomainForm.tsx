"use client";

import { useActionState } from "react";
import { addDomainAction, type FormState } from "../../app/actions";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400";

export function AddDomainForm({ dealerId }: { dealerId: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addDomainAction, { error: null });
  return (
    <form action={action} className="mt-4 space-y-2">
      <input type="hidden" name="id" value={dealerId} />
      <div className="flex flex-wrap gap-2">
        <input name="hostname" placeholder="stock.example.co.uk" required className={`${input} min-w-64 flex-1`} />
        <select name="kind" className={input} defaultValue="staff">
          <option value="staff">Staff sign-in and stock book</option>
          <option value="showroom">Public showroom website</option>
        </select>
        <button disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {pending ? "Adding…" : "Add address"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
