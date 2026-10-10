import { useSyncExternalStore } from "react";
import { Link } from "@/lib/router";
import { Cookie } from "lucide-react";
import { showroomHref } from "@/lib/showroomHost";

// Lightweight, dependency-free cookie-consent state for the public showroom.
//
// We store the visitor's choice in localStorage (not a cookie) so reading it
// never itself sets a tracked cookie. Non-essential third-party content — namely
// the Google Maps embed on the Contact page — is only loaded once the visitor
// has accepted. "Reject" is the safe default: nothing non-essential loads.

export type ConsentStatus = "accepted" | "rejected" | "unset";

const STORAGE_KEY = "showroom-cookie-consent";

function readStored(): ConsentStatus {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "accepted" || v === "rejected" ? v : "unset";
  } catch {
    return "unset";
  }
}

type Snapshot = { status: ConsentStatus; reopened: boolean };

// A single cached snapshot reference so useSyncExternalStore can detect change
// by identity (returning a fresh object every read would loop forever).
let snapshot: Snapshot = { status: readStored(), reopened: false };

const listeners = new Set<() => void>();

function setSnapshot(next: Snapshot): void {
  snapshot = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

// Record the visitor's choice and hide the banner.
export function setConsent(status: "accepted" | "rejected"): void {
  try {
    localStorage.setItem(STORAGE_KEY, status);
  } catch {
    /* private mode / storage disabled — fall back to in-memory only */
  }
  setSnapshot({ status, reopened: false });
}

// Re-show the banner so the visitor can change a previous decision (wired to the
// "Cookie settings" link in the footer). Not persisted — purely transient UI.
export function reopenConsent(): void {
  setSnapshot({ status: snapshot.status, reopened: true });
}

export function useCookieConsent() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    status: snap.status,
    showBanner: snap.status === "unset" || snap.reopened,
    accept: () => setConsent("accepted"),
    reject: () => setConsent("rejected"),
    reopen: reopenConsent,
  };
}

// Fixed consent banner. Mounted once at the showroom router-shell level (see
// App.tsx) so it appears on EVERY showroom route and transient state (loading,
// not-found, error), not only pages that render the footer. Because it sits
// outside any page's accent scope it uses neutral slate styling so it looks
// intentional on any dealer's palette.
export function CookieBanner() {
  const { showBanner, accept, reject } = useCookieConsent();
  if (!showBanner) return null;
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4"
      role="dialog"
      aria-label="Cookie consent"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100">
              <Cookie className="h-5 w-5 text-slate-700" />
            </span>
            <p className="text-sm leading-relaxed text-slate-600">
              We use essential cookies to make this site work. With your consent we
              also load an interactive map on our contact page, which may set
              cookies. See our{" "}
              <Link href={showroomHref("/cookies")}>
                <span className="cursor-pointer font-medium text-slate-900 underline hover:no-underline">
                  Cookie Policy
                </span>
              </Link>{" "}
              and{" "}
              <Link href={showroomHref("/privacy")}>
                <span className="cursor-pointer font-medium text-slate-900 underline hover:no-underline">
                  Privacy Policy
                </span>
              </Link>
              .
            </p>
          </div>
          <div className="flex shrink-0 gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={reject}
              className="flex-1 whitespace-nowrap rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:flex-none"
            >
              Reject non-essential
            </button>
            <button
              type="button"
              onClick={accept}
              className="flex-1 whitespace-nowrap rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 sm:flex-none"
            >
              Accept all
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
