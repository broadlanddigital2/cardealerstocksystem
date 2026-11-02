"use client";

import { useActionState } from "react";
import type { EmailFormState } from "../../app/actions";

/** "Add these records in Cloudflare": runs the given action and shows what changed. */
export function ApplyDnsButton({
  action,
  fields,
  confirmText,
  label = "Add these records in Cloudflare",
}: {
  action: (prev: EmailFormState, form: FormData) => Promise<EmailFormState>;
  fields: Record<string, string | number>;
  confirmText: string;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(confirmText)) e.preventDefault();
      }}
      className="space-y-1"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50"
      >
        {pending ? "Adding…" : label}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.notice && <p className="text-xs text-green-700">{state.notice}</p>}
    </form>
  );
}
