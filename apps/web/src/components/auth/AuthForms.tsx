"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useLocation } from "@/lib/router";
import { useSession } from "@/lib/auth";

const logoUrl = "/assets/motormetric-logo.png";

function AuthCard({ title, subtitle, children, footer }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white w-[440px] max-w-full rounded-xl shadow-lg border border-slate-200 p-8">
        <Link href="/" className="block">
          <img src={logoUrl} alt="MotorMetric" className="mx-auto h-20 w-auto" />
        </Link>
        <h1 className="mt-4 text-xl font-bold text-slate-900 text-center">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 text-center">{subtitle}</p>}
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 text-center text-sm text-slate-500">{footer}</div>}
      </div>
    </div>
  );
}

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
      {message}
    </p>
  );
}

// Send signed-in users straight into the app.
function useRedirectIfSignedIn(to = "/stock") {
  const { session, isLoaded } = useSession();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (isLoaded && session) setLocation(to, { replace: true });
  }, [isLoaded, session, setLocation, to]);
}

export function SignInForm() {
  useRedirectIfSignedIn();
  const [, setLocation] = useLocation();
  const { refresh } = useSession();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    const address = email.trim().toLowerCase();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "We couldn't send a code. Please try again.");
        return;
      }
      setEmail(address);
      setCode("");
      setStep("code");
      setNotice(`If ${address} has been invited, a sign-in code is on its way. It expires in 10 minutes.`);
    } catch {
      setError("We couldn't send a code. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, code: token }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "That code is wrong or has expired. Send a new code and try again.");
        return;
      }
      await refresh();
    } catch {
      setError("We couldn't check the code. Check your connection and try again.");
      return;
    } finally {
      setBusy(false);
    }
    setLocation("/stock", { replace: true });
  }

  if (step === "code") {
    return (
      <AuthCard
        title="Enter your code"
        subtitle={notice ?? undefined}
        footer={
          <button
            type="button"
            className="font-medium text-slate-900 hover:underline"
            onClick={() => { setStep("email"); setError(null); setNotice(null); }}
          >
            Use a different email
          </button>
        }
      >
        <form onSubmit={verifyCode} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">Sign-in code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={6}
              autoFocus
              required
              placeholder="123456"
              className="text-center text-2xl tracking-[0.4em] font-semibold"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            />
          </div>
          <ErrorText message={error} />
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sign in
          </Button>
          <button
            type="button"
            disabled={busy}
            onClick={() => requestCode()}
            className="w-full text-sm text-slate-500 hover:text-slate-900 hover:underline disabled:opacity-50"
          >
            Send a new code
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in" subtitle="We'll email you a sign-in code — no password needed.">
      <form onSubmit={requestCode} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input id="email" type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <ErrorText message={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Email me a code
        </Button>
      </form>
    </AuthCard>
  );
}

// Old email-link landing page (sign-in is by code now): send signed-in users
// on, and everyone else to the sign-in page.
export function AuthCallback() {
  const { session, isLoaded } = useSession();
  const [, setLocation] = useLocation();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (session) setLocation("/stock", { replace: true });
  }, [session, setLocation]);

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);

  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const linkError = params?.get("error_description");

  if (linkError || (isLoaded && timedOut && !session)) {
    return (
      <AuthCard
        title="That link didn't work"
        subtitle={linkError ?? "The link may have expired or already been used. Please sign in, or request a new link."}
        footer={<Link href="/sign-in" className="font-medium text-slate-900 hover:underline">Go to sign in</Link>}
      >
        <></>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Signing you in…">
      <div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
    </AuthCard>
  );
}

