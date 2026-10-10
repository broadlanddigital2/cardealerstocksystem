"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useLocation } from "@/lib/router";
import { getSupabase, siteUrl, useSession } from "@/lib/auth";

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

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Incorrect email or password.";
  if (/email not confirmed/i.test(message)) return "Please confirm your email address first — check your inbox for the link.";
  if (/rate limit/i.test(message)) return "Too many attempts. Please wait a minute and try again.";
  return message;
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(friendly(error.message));
    else setLocation("/stock", { replace: true });
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="to the MotorMetric stock book"
      footer={<>No account yet? <Link href="/sign-up" className="font-medium text-slate-900 hover:underline">Create one</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-xs text-slate-500 hover:text-slate-900 hover:underline">Forgot password?</Link>
          </div>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <ErrorText message={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

export function SignUpForm() {
  useRedirectIfSignedIn();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error } = await getSupabase().auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: name.trim() || undefined },
        emailRedirectTo: siteUrl("/auth/callback"),
      },
    });
    setBusy(false);
    if (error) setError(friendly(error.message));
    else if (!data.session) setSent(true); // email confirmation required
  }

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`We've sent a confirmation link to ${email}. Open it on this device to finish creating your account.`}
        footer={<Link href="/sign-in" className="font-medium text-slate-900 hover:underline">Back to sign in</Link>}
      >
        <></>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Use the email address the dealer invited"
      footer={<>Already have an account? <Link href="/sign-in" className="font-medium text-slate-900 hover:underline">Sign in</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-xs text-slate-500">At least 8 characters.</p>
        </div>
        <ErrorText message={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create account
        </Button>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: siteUrl("/auth/reset-password"),
    });
    setBusy(false);
    if (error) setError(friendly(error.message));
    else setSent(true);
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle={sent ? `If ${email} has an account, a reset link is on its way.` : "We'll email you a link to choose a new password."}
      footer={<Link href="/sign-in" className="font-medium text-slate-900 hover:underline">Back to sign in</Link>}
    >
      {!sent && (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <ErrorText message={error} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

// Landing page for email links. supabase-js exchanges the ?code= for a session
// automatically (PKCE); we just wait for it and move on.
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

export function ResetPasswordForm() {
  const { session, isLoaded } = useSession();
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().auth.updateUser({ password });
    setBusy(false);
    if (error) setError(friendly(error.message));
    else setLocation("/stock", { replace: true });
  }

  if (isLoaded && !session) {
    return (
      <AuthCard
        title="Link expired"
        subtitle="This password reset link is no longer valid. Request a new one."
        footer={<Link href="/forgot-password" className="font-medium text-slate-900 hover:underline">Request a new link</Link>}
      >
        <></>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <ErrorText message={error} />
        <Button type="submit" className="w-full" disabled={busy || !session}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save password
        </Button>
      </form>
    </AuthCard>
  );
}
