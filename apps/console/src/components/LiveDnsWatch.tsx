"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * After records are added in Cloudflare: asks for a fresh DNS check every 20
 * seconds and redraws the section, so the ticks change as the records are
 * seen. Stops when everything passes or after `until`.
 */
export function LiveDnsWatch({
  dealerId,
  until,
  done,
  notice,
  poll,
}: {
  dealerId: number;
  until: number;
  done: boolean;
  notice: string | null;
  poll: (dealerId: number) => Promise<void>;
}) {
  const router = useRouter();
  const [last, setLast] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const expired = now > until;

  useEffect(() => {
    if (done || expired) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      try {
        await poll(dealerId);
      } catch {
        // keep trying; the next tick may work
      }
      if (stopped) return;
      setLast(new Date());
      router.refresh();
      timer = setTimeout(tick, 20_000);
    };
    timer = setTimeout(tick, 5_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [dealerId, done, expired, poll, router]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const time = (d: Date | number) => new Date(d).toLocaleTimeString("en-GB", { timeZone: "Europe/London" });
  return (
    <div
      className={`mt-3 flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-xs ${
        done ? "bg-green-50 text-green-800" : expired ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-900"
      }`}
      role="status"
      aria-live="polite"
    >
      {!done && !expired && <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" aria-hidden />}
      <span>
        {notice && <>{notice} </>}
        {done
          ? "Everything is in place."
          : expired
            ? "Stopped watching. Some records aren't showing yet: DNS can take up to an hour. Use Check DNS later."
            : `Watching for the new records, checking every 20 seconds${last ? ` (last ${time(last)})` : ""}. Stops at ${time(until)}.`}
      </span>
    </div>
  );
}
