"use client";

import { useActionState, useState } from "react";
import {
  addForwardingAction,
  addMailboxAction,
  deleteMailboxAction,
  resetMailboxPasswordAction,
  setUpEmailAction,
  type EmailFormState,
} from "../../app/actions";
import { CopyButton } from "./CopyButton";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400";
const button = "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50";
const empty: EmailFormState = { error: null };

/** A new password, shown once with a copy button. */
function OneTimePassword({ address, password }: { address: string; password: string }) {
  return (
    <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
      <p className="font-medium text-green-900">{address} is ready.</p>
      <p className="mt-1 text-green-900">
        Password: <span className="font-mono">{password}</span>
        <CopyButton value={password} label="password" />
      </p>
      <p className="mt-1 text-xs text-green-800">
        Shown once only, so copy it now and give it to the person directly (not in the same email as the address).
      </p>
    </div>
  );
}

export function SetUpEmailForm({ dealerId, suggested }: { dealerId: number; suggested: string }) {
  const [state, action, pending] = useActionState(setUpEmailAction, empty);
  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={dealerId} />
      <input name="domain" defaultValue={suggested} placeholder="manorgcs.co.uk" required className={`${input} min-w-56`} />
      <button disabled={pending} className={button}>{pending ? "Setting up…" : "Set up email"}</button>
      {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export function AddMailboxForm({ dealerId, domain }: { dealerId: number; domain: string }) {
  const [state, action, pending] = useActionState(addMailboxAction, empty);
  const [how, setHow] = useState<"invite" | "create">("invite");
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="id" value={dealerId} />
      <input type="hidden" name="how" value={how} />
      <h3 className="text-sm font-semibold">Add a mailbox</h3>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center">
          <input name="local" placeholder="john.smith" required className={`${input} w-44 rounded-r-none`} />
          <span className="rounded-r-md border border-l-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">@{domain}</span>
        </span>
        <input name="name" placeholder="Name (optional)" className={`${input} w-48`} />
      </div>
      <fieldset className="space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="radio" checked={how === "invite"} onChange={() => setHow("invite")} className="mt-1" />
          <span>
            <span className="font-medium">Email them an invitation</span> (recommended): they choose their own password.
            <input
              name="recipient"
              type="email"
              placeholder="their current email address"
              required={how === "invite"}
              disabled={how !== "invite"}
              className={`${input} mt-1 block w-72 disabled:bg-slate-100`}
            />
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" checked={how === "create"} onChange={() => setHow("create")} className="mt-1" />
          <span>
            <span className="font-medium">Create it now</span>: you get a one-time password to pass on.
          </span>
        </label>
      </fieldset>
      <button disabled={pending} className={button}>
        {pending ? "Working…" : how === "invite" ? "Send invitation" : "Create mailbox"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.notice && <p className="text-sm text-green-700">{state.notice}</p>}
      {state.address && state.password && <OneTimePassword address={state.address} password={state.password} />}
    </form>
  );
}

export function MailboxActions({ dealerId, mailboxId, address }: { dealerId: number; mailboxId: number; address: string }) {
  const [reset, resetAction, resetting] = useActionState(resetMailboxPasswordAction, empty);
  const [del, delAction, deleting] = useActionState(deleteMailboxAction, empty);
  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-3">
        <form
          action={resetAction}
          onSubmit={(e) => {
            if (!confirm(`Set a new password for ${address}?\n\nThey'll be signed out of mail apps and need the new password.`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={dealerId} />
          <input type="hidden" name="mailboxId" value={mailboxId} />
          <button disabled={resetting} className="text-xs text-slate-700 hover:underline disabled:opacity-50">
            {resetting ? "Resetting…" : "Reset password"}
          </button>
        </form>
        <form
          action={delAction}
          onSubmit={(e) => {
            if (!confirm(`Delete ${address}?\n\nMail stops arriving straight away. TrekMail keeps it under "Recently deleted" for a short time.`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={dealerId} />
          <input type="hidden" name="mailboxId" value={mailboxId} />
          <button disabled={deleting} className="text-xs text-red-700 hover:underline disabled:opacity-50">
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </form>
      </div>
      {(reset.error || del.error) && <p className="text-right text-xs text-red-600">{reset.error ?? del.error}</p>}
      {reset.address && reset.password && <OneTimePassword address={reset.address} password={reset.password} />}
    </div>
  );
}

export function AddForwardingForm({ dealerId, domain }: { dealerId: number; domain: string }) {
  const [state, action, pending] = useActionState(addForwardingAction, empty);
  return (
    <form action={action} className="space-y-2 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="id" value={dealerId} />
      <h3 className="text-sm font-semibold">Add a forwarding address</h3>
      <p className="text-xs text-slate-500">An address with no mailbox of its own, e.g. sales@ passed on to two salespeople.</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center">
          <input name="local" placeholder="sales" required className={`${input} w-32 rounded-r-none`} />
          <span className="rounded-r-md border border-l-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">@{domain}</span>
        </span>
        <span className="text-sm text-slate-500">→</span>
        <input name="recipients" placeholder="anna@…, ben@…" required className={`${input} min-w-64 flex-1`} />
        <button disabled={pending} className={button}>{pending ? "Adding…" : "Add"}</button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
