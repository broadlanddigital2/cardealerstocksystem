import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { showroomHref } from "@/lib/showroomHost";
import { Car, Phone } from "lucide-react";
import {
  ShowroomHeader,
  ShowroomFooter,
  VehicleCard,
  accentVars,
  type ShowroomData,
} from "@/views/Showroom";

const basePath = "";

type SortKey = "price-asc" | "price-desc";

export default function ShowroomStock() {
  const [data, setData] = useState<ShowroomData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sort, setSort] = useState<SortKey>("price-asc");
  const [makeFilter, setMakeFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${basePath}/api/showroom`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const makes = useMemo(() => {
    if (!data) return [];
    return Array.from(
      new Set(data.vehicles.map((v) => v.make).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const models = useMemo(() => {
    if (!data) return [];
    const pool =
      makeFilter === "all"
        ? data.vehicles
        : data.vehicles.filter((v) => v.make === makeFilter);
    return Array.from(
      new Set(pool.map((v) => v.model).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));
  }, [data, makeFilter]);

  useEffect(() => {
    if (modelFilter !== "all" && !models.includes(modelFilter)) {
      setModelFilter("all");
    }
  }, [models, modelFilter]);

  const sortedVehicles = useMemo(() => {
    if (!data) return [];
    let list = data.vehicles.filter(
      (v) =>
        (makeFilter === "all" || v.make === makeFilter) &&
        (modelFilter === "all" || v.model === modelFilter),
    );
    if (sort === "price-asc") {
      list = [...list].sort(
        (a, b) => (a.askingPrice ?? Infinity) - (b.askingPrice ?? Infinity),
      );
    } else if (sort === "price-desc") {
      list = [...list].sort(
        (a, b) => (b.askingPrice ?? -Infinity) - (a.askingPrice ?? -Infinity),
      );
    }
    return list;
  }, [data, sort, makeFilter, modelFilter]);

  if (status === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>;
  }

  if (status === "error" || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 text-center text-slate-500">
        Sorry, the website is currently unavailable. Please try again later.
      </div>
    );
  }

  const { dealer } = data;

  if (!dealer.showroomEnabled) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col" style={accentVars(dealer)}>
        <ShowroomHeader dealer={dealer} />
        <div className="flex-1 flex items-center justify-center p-4 text-center text-slate-500">
          Our website is currently unavailable. Please contact us directly for current stock.
        </div>
        <ShowroomFooter dealer={dealer} />
      </div>
    );
  }

  const vehicles = sortedVehicles;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" style={accentVars(dealer)}>
      <ShowroomHeader dealer={dealer} />

      {/* Page heading */}
      <section className="bg-[var(--bg)]">
        <div className="max-w-6xl mx-auto px-4 py-10">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--bg-text)]">Our current stock</h1>
        </div>
      </section>

      <main className="flex-1 max-w-6xl mx-auto px-4 py-10 w-full">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <p className="text-slate-600 text-sm font-medium">
            {vehicles.length} {vehicles.length === 1 ? "vehicle" : "vehicles"}
            {makeFilter === "all" && modelFilter === "all"
              ? " in stock"
              : " match your filter"}
          </p>
          <div className="flex flex-wrap items-end gap-4">
            {makes.length > 1 && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                Make
                <select
                  value={makeFilter}
                  onChange={(e) => setMakeFilter(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="all">All makes</option>
                  {makes.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {models.length > 1 && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                Model
                <select
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="all">All models</option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {data.vehicles.length > 1 && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                Sort by
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="price-asc">Price: low to high</option>
                  <option value="price-desc">Price: high to low</option>
                </select>
              </label>
            )}
          </div>
        </div>

        {vehicles.length === 0 &&
        (makeFilter !== "all" || modelFilter !== "all") ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center">
            <Car className="h-12 w-12 mx-auto mb-4 text-slate-300" />
            <p className="text-lg font-semibold text-slate-700">No matching vehicles</p>
            <p className="text-slate-500 mt-1">Try a different make or model.</p>
            <button
              type="button"
              onClick={() => {
                setMakeFilter("all");
                setModelFilter("all");
              }}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-95"
            >
              Clear filters
            </button>
          </div>
        ) : vehicles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center">
            <Car className="h-12 w-12 mx-auto mb-4 text-slate-300" />
            <p className="text-lg font-semibold text-slate-700">No vehicles available right now</p>
            <p className="text-slate-500 mt-1">New stock arrives regularly — please check back soon.</p>
            {dealer.phone && (
              <a
                href={`tel:${dealer.phone.replace(/\s+/g, "")}`}
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-95"
              >
                <Phone className="h-4 w-4" /> Call us about upcoming stock
              </a>
            )}
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {vehicles.map((v) => (
              <VehicleCard key={v.id} v={v} />
            ))}
          </div>
        )}

        <div className="mt-10">
          <Link href={showroomHref()}>
            <span className="text-sm font-medium text-slate-500 hover:text-slate-900 cursor-pointer">
              ← Back to home
            </span>
          </Link>
        </div>
      </main>

      <ShowroomFooter dealer={dealer} />
    </div>
  );
}
