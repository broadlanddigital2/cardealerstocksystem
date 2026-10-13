"use client";

import { useActionState } from "react";
import { MODULES } from "@workspace/modules";
import type { FormState } from "../../app/actions";

const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100";

export interface DealerFormValues {
  id?: number;
  name: string;
  slug: string;
  companyNumber: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  billingEmail: string;
  webDomain: string;
  staffDomain: string;
  showroomDomain: string;
  firstAdminEmail: string;
  modules: string[];
  notes: string;
  slugLocked?: boolean;
}

function Field({ label, name, value, hint, type = "text", required, disabled }: {
  label: string;
  name: string;
  value: string;
  hint?: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <input name={name} type={type} defaultValue={value} required={required} disabled={disabled} className={input} />
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function DealerForm({
  values,
  action,
  submitLabel,
}: {
  values: DealerFormValues;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="space-y-8">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {values.slugLocked && <input type="hidden" name="slug" value={values.slug} />}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Business</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" name="name" value={values.name} required />
          <Field
            label="Short id"
            name={values.slugLocked ? "slug-display" : "slug"}
            value={values.slug}
            required
            disabled={values.slugLocked}
            hint={values.slugLocked ? "Fixed once the dealer is set up." : "Used in their addresses, e.g. manor-garage. Lower-case letters, numbers, hyphens."}
          />
          <Field label="Company number" name="companyNumber" value={values.companyNumber} />
          <Field label="Billing email" name="billingEmail" type="email" value={values.billingEmail} />
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Contact and first admin</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name" name="contactName" value={values.contactName} />
          <Field label="Contact phone" name="contactPhone" value={values.contactPhone} />
          <Field label="Contact email" name="contactEmail" type="email" value={values.contactEmail} />
          <Field
            label="First admin's email"
            name="firstAdminEmail"
            type="email"
            value={values.firstAdminEmail}
            required
            hint="Gets admin access when the site is set up, and invites their own staff."
          />
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Domains</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dealer's web domain" name="webDomain" value={values.webDomain} hint="e.g. manorgcs.co.uk. Used for their email sender and accounts." />
          <Field label="Staff address" name="staffDomain" value={values.staffDomain} hint="Leave blank to use the default address." />
          <Field label="Showroom website address" name="showroomDomain" value={values.showroomDomain} hint="Optional, e.g. www.manorgcs.co.uk." />
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Modules</h2>
        <p className="text-sm text-slate-500">What this dealer has. The stock book itself is always included.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODULES.map((m) => (
            <label key={m.key} className="flex items-start gap-3 rounded-md border border-slate-200 p-3">
              <input type="checkbox" name="module" value={m.key} defaultChecked={values.modules.includes(m.key)} className="mt-1" />
              <span>
                <span className="block text-sm font-medium">{m.name}</span>
                <span className="block text-xs text-slate-500">{m.description}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-6">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Notes</span>
          <textarea name="notes" defaultValue={values.notes} rows={3} className={input} />
        </label>
      </section>

      {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
