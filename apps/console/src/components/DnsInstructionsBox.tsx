"use client";

import { useActionState, useState } from "react";
import { sendDnsInstructionsAction, type EmailFormState } from "../../app/actions";

/** The DNS records written up for the dealer: copy them all, or email them from the console. */
export function DnsInstructionsBox({
  dealerId,
  kind,
  domainId,
  text,
  defaultTo,
}: {
  dealerId: number;
  kind: "email" | "web";
  domainId?: number;
  text: string;
  defaultTo: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [state, action, pending] = useActionState<EmailFormState, FormData>(sendDnsInstructionsAction, { error: null });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-blue-700 hover:underline">
        Send these to the dealer…
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-700">Instructions for the dealer (or their web person)</span>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
          Close
        </button>
      </div>
      <textarea readOnly value={text} rows={12} className="w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-xs" />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              /* clipboard blocked: the text can still be selected */
            }
          }}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-100"
        >
          {copied ? "Copied" : "Copy all"}
        </button>
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={dealerId} />
          <input type="hidden" name="kind" value={kind} />
          {domainId && <input type="hidden" name="domainId" value={domainId} />}
          <input
            name="to"
            type="email"
            required
            defaultValue={defaultTo}
            placeholder="dealer@example.co.uk"
            className="w-64 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
          />
          <button disabled={pending} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {pending ? "Sending…" : "Email to dealer"}
          </button>
        </form>
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.notice && <p className="text-xs text-green-700">{state.notice}</p>}
    </div>
  );
}
