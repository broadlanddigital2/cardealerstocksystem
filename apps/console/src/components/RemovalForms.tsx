"use client";

import { useActionState } from "react";
import { deleteNowAction, removeDealerAction, restoreDealerAction, type FormState } from "../../app/actions";

const empty: FormState = { error: null };
const input = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300";

export function RemoveDealerForm({
  dealerId,
  slug,
  draft,
  emailDomain,
}: {
  dealerId: number;
  slug: string;
  draft: boolean;
  emailDomain: string | null;
}) {
  const [state, action, pending] = useActionState(removeDealerAction, empty);
  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="id" value={dealerId} />
      {!draft && emailDomain && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="removeEmail" className="mt-1" />
          <span>
            Also delete their email (<span className="font-mono">{emailDomain}</span> and all its mailboxes) when everything is
            deleted. Leave unticked if they're keeping their email.
          </span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input name="confirm" placeholder={`Type ${slug} to confirm`} autoComplete="off" className={`${input} w-64`} />
        <button disabled={pending} className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50">
          {pending ? "Removing…" : draft ? "Delete this dealer" : "Remove dealer"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export function RestoreDealerButton({ dealerId }: { dealerId: number }) {
  const [state, action, pending] = useActionState(restoreDealerAction, empty);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="id" value={dealerId} />
      <button disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
        {pending ? "Reopening…" : "Undo removal (reopen the site)"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export function DeleteNowForm({ dealerId, slug }: { dealerId: number; slug: string }) {
  const [state, action, pending] = useActionState(deleteNowAction, empty);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={dealerId} />
      <div className="flex flex-wrap items-center gap-2">
        <input name="confirm" placeholder={`Type ${slug} to confirm`} autoComplete="off" className={`${input} w-64`} />
        <button disabled={pending} className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50">
          {pending ? "Starting…" : "Delete everything now"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
