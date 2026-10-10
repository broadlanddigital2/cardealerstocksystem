import { useEffect, useState } from "react";
import { Link } from "wouter";
import { showroomHref } from "@/lib/showroomHost";
import { formatCurrency } from "@/lib/format";
import {
  ImageOff,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Gauge,
  Palette,
  Phone,
  Mail,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import {
  ShowroomHeader,
  ShowroomFooter,
  accentVars,
  vehicleDetails,
  vehicleEnquiryMessage,
  SoldBanner,
  type ShowroomDealer,
} from "@/pages/Showroom";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ShowroomVehicleData {
  id: number;
  make: string;
  model: string;
  description: string | null;
  registrationNumber: string | null;
  colour: string | null;
  mileage: number | null;
  askingPrice: number | null;
  marketingDescription: string | null;
  showroomSold: boolean;
  photoUrls: string[];
}

function photoSrc(path: string) {
  return `${basePath}/api/storage${path}`;
}

function EnquiryForm({ vehicle, dealerName }: { vehicle: ShowroomVehicleData; dealerName: string }) {
  const vehicleId = vehicle.id;
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: vehicleEnquiryMessage(vehicle) });
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${basePath}/api/showroom/enquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, company: honeypot, vehicleId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Could not send your enquiry. Please try again.");
      }
      setDone(true);
    } catch (err: any) {
      setError(err?.message ?? "Could not send your enquiry. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <CheckCircle2 className="h-12 w-12 text-[var(--accent)] mx-auto mb-3" />
        <h3 className="font-semibold text-slate-900 text-lg">Thank you</h3>
        <p className="text-sm text-slate-500 mt-1">
          Your enquiry has been sent to {dealerName}. We'll be in touch soon.
        </p>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent";

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-sm">
      <div>
        <h3 className="font-semibold text-slate-900 text-lg">Enquire about this vehicle</h3>
        <p className="text-sm text-slate-500 mt-0.5">Send a message and we'll get straight back to you.</p>
      </div>
      {/* Honeypot: hidden from real users, catches bots that fill every field. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden" tabIndex={-1}>
        <label>
          Company
          <input
            type="text"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      <div className="space-y-1">
        <label htmlFor="enq-name" className="text-sm font-medium text-slate-700">Name *</label>
        <input
          id="enq-name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="enq-email" className="text-sm font-medium text-slate-700">Email</label>
          <input
            id="enq-email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="enq-phone" className="text-sm font-medium text-slate-700">Phone</label>
          <input
            id="enq-phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>
      <p className="text-xs text-slate-500 -mt-2">Please provide an email or phone number so we can reply.</p>
      <div className="space-y-1">
        <label htmlFor="enq-message" className="text-sm font-medium text-slate-700">Message *</label>
        <textarea
          id="enq-message"
          required
          rows={4}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          className={inputClass}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="enq-vehicle" className="text-sm font-medium text-slate-700">Vehicle</label>
        <textarea
          id="enq-vehicle"
          readOnly
          rows={4}
          value={vehicleDetails(vehicle)}
          className={`${inputClass} resize-none bg-slate-50 text-slate-600`}
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full inline-flex items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
      >
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Send enquiry
      </button>
    </form>
  );
}

function SpecRow({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
        <Icon className="h-4 w-4 text-slate-500" />
      </div>
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-sm font-medium text-slate-900">{value}</div>
      </div>
    </div>
  );
}

export default function ShowroomVehicle({ id }: { id: string }) {
  const [dealer, setDealer] = useState<ShowroomDealer | null>(null);
  const [vehicle, setVehicle] = useState<ShowroomVehicleData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [activePhoto, setActivePhoto] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch(`${basePath}/api/showroom/vehicles/${id}`);
        if (res.status === 404) {
          if (!cancelled) setStatus("notfound");
          return;
        }
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!cancelled) {
          setDealer(json.dealer);
          setVehicle(json.vehicle);
          setActivePhoto(0);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (status === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>;
  }

  if (status === "notfound") {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 text-center text-slate-500 gap-4">
        <p>This vehicle is no longer available.</p>
        <Link href={showroomHref("/stock")}>
          <span className="text-[#5f9128] hover:underline cursor-pointer">Back to stock</span>
        </Link>
      </div>
    );
  }

  if (status === "error" || !vehicle || !dealer) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 text-center text-slate-500">
        Sorry, something went wrong. Please try again later.
      </div>
    );
  }

  const photoCount = vehicle.photoUrls.length;
  const goPrev = () => setActivePhoto((i) => (i - 1 + photoCount) % photoCount);
  const goNext = () => setActivePhoto((i) => (i + 1) % photoCount);
  const telHref = dealer.phone ? `tel:${dealer.phone.replace(/\s+/g, "")}` : null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" style={accentVars(dealer)}>
      <ShowroomHeader dealer={dealer} />

      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        <Link href={showroomHref("/stock")}>
          <span className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 cursor-pointer mb-6">
            <ArrowLeft className="h-4 w-4" /> Back to stock
          </span>
        </Link>

        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          {/* Gallery */}
          <div className="space-y-3">
            <div className="group relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100 shadow-sm flex items-center justify-center">
              {vehicle.photoUrls[activePhoto] ? (
                <img
                  src={photoSrc(vehicle.photoUrls[activePhoto])}
                  alt={`${vehicle.make} ${vehicle.model}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <ImageOff className="h-12 w-12 text-slate-300" />
              )}
              {vehicle.showroomSold && <SoldBanner />}
              {photoCount > 1 && (
                <>
                  <button
                    type="button"
                    onClick={goPrev}
                    aria-label="Previous photo"
                    className="absolute left-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    aria-label="Next photo"
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                  <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
                    {activePhoto + 1} / {photoCount}
                  </span>
                </>
              )}
            </div>
            {photoCount > 1 && (
              <div className="grid grid-cols-5 gap-2">
                {vehicle.photoUrls.map((p, i) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setActivePhoto(i)}
                    aria-label={`View photo ${i + 1}`}
                    className={`aspect-square overflow-hidden rounded-lg border-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                      i === activePhoto ? "border-[var(--accent)]" : "border-transparent opacity-70 hover:opacity-100"
                    }`}
                  >
                    <img src={photoSrc(p)} alt={`Thumbnail ${i + 1}`} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details / sticky enquiry column */}
          <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {vehicle.make} {vehicle.model}
              </h1>
              {vehicle.description && (
                <p className="mt-1 text-sm text-slate-600">{vehicle.description}</p>
              )}
              <div className="mt-3 text-3xl font-bold text-slate-900">
                {vehicle.askingPrice != null ? formatCurrency(vehicle.askingPrice) : "POA"}
              </div>

              <div className="mt-4 divide-y divide-slate-100">
                {vehicle.mileage != null && (
                  <SpecRow icon={Gauge} label="Mileage" value={`${vehicle.mileage.toLocaleString()} miles`} />
                )}
                {vehicle.colour && <SpecRow icon={Palette} label="Colour" value={vehicle.colour} />}
              </div>

              {vehicle.marketingDescription && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <h2 className="text-sm font-semibold text-slate-900 mb-1">Description</h2>
                  <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                    {vehicle.marketingDescription}
                  </p>
                </div>
              )}

              <div className="mt-4 flex flex-col gap-2">
                {telHref && (
                  <a
                    href={telHref}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Phone className="h-4 w-4" /> Call {dealer.phone}
                  </a>
                )}
                {dealer.email && (
                  <a
                    href={`mailto:${dealer.email}?subject=${encodeURIComponent(`Enquiry: ${vehicle.make} ${vehicle.model}`)}`}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Mail className="h-4 w-4" /> Email us
                  </a>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
                Enquire today to arrange a viewing or test drive.
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <EnquiryForm key={vehicle.id} vehicle={vehicle} dealerName={dealer.businessName} />
        </div>
      </main>

      <ShowroomFooter dealer={dealer} />
    </div>
  );
}
