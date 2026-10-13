"use client";

import { useActionState } from "react";
import { sendCodeAction, verifyCodeAction, type FormState } from "../../app/actions";

const initial: FormState = { error: null };
const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400";
const button = "w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50";

export function SignInForms({ email }: { email: string | null }) {
  const [sendState, sendAction, sending] = useActionState(sendCodeAction, initial);
  const [verifyState, verifyAction, verifying] = useActionState(verifyCodeAction, initial);

  if (email) {
    return (
      <form action={verifyAction} className="space-y-4">
        <p className="text-sm text-slate-600">If {email} is a console admin, a code is on its way.</p>
        <input type="hidden" name="email" value={email} />
        <label className="block space-y-1">
          <span className="text-sm font-medium">Sign-in code</span>
          <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus className={`${input} text-center text-xl tracking-[0.4em]`} />
        </label>
        {verifyState.error && <p className="text-sm text-red-600">{verifyState.error}</p>}
        <button className={button} disabled={verifying}>Sign in</button>
        <a href="/sign-in" className="block text-center text-sm text-slate-500 hover:underline">Use a different email</a>
      </form>
    );
  }
  return (
    <form action={sendAction} className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-medium">Email address</span>
        <input name="email" type="email" autoComplete="email" required autoFocus className={input} />
      </label>
      {sendState.error && <p className="text-sm text-red-600">{sendState.error}</p>}
      <button className={button} disabled={sending}>Email me a code</button>
    </form>
  );
}
