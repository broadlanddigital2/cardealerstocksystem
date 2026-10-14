"use client";

import { useState } from "react";

/** Small "Copy" button for a DNS value. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked: the value is still selectable */
        }
      }}
      className="ml-2 shrink-0 rounded border border-slate-300 px-1.5 py-0.5 font-sans text-[11px] text-slate-600 hover:bg-slate-100"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
