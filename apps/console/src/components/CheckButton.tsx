"use client";

import { useFormStatus } from "react-dom";

/** Submit button for re-checking an address's DNS with Cloudflare. */
export function CheckButton({ children = "Check DNS" }: { children?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`}>
        <path d="M15.3 4.7A7 7 0 0 0 3.1 9h2a5 5 0 0 1 8.8-2.9L12 8h5V3l-1.7 1.7ZM4.7 15.3A7 7 0 0 0 16.9 11h-2a5 5 0 0 1-8.8 2.9L8 12H3v5l1.7-1.7Z" />
      </svg>
      {pending ? "Checking…" : children}
    </button>
  );
}
