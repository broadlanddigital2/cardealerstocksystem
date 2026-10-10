import { useEffect, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  Phone,
  Mail,
  MapPin,
} from "lucide-react";
import { useCookieConsent } from "@/components/showroom/CookieConsent";
import {
  ShowroomHeader,
  ShowroomFooter,
  accentVars,
  vehicleLabel,
  vehicleDetails,
  vehicleEnquiryMessage,
  type ShowroomDealer,
  type ShowroomData,
  type ShowroomVehicle,
} from "@/views/Showroom";

const basePath = "";

function telHrefOf(phone: string | null) {
  return phone ? `tel:${phone.replace(/\s+/g, "")}` : null;
}

function ContactForm({
  dealerName,
  vehicles,
  initialVehicleId,
}: {
  dealerName: string;
  vehicles: ShowroomVehicle[];
  initialVehicleId: number | null;
}) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  // Tracks whether the customer has edited the message themselves, so we don't
  // overwrite their text when they change the selected vehicle.
  const [messageTouched, setMessageTouched] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedVehicle = vehicleId != null ? vehicles.find((v) => v.id === vehicleId) ?? null : null;

  const selectVehicle = (id: number | null) => {
    setVehicleId(id);
    const vehicle = id != null ? vehicles.find((v) => v.id === id) ?? null : null;
    // Auto-fill the enquiry message for the chosen vehicle, unless the customer
    // has already typed their own message.
    if (!messageTouched) {
      setForm((f) => ({ ...f, message: vehicle ? vehicleEnquiryMessage(vehicle) : "" }));
    }
  };

  // Pre-select a vehicle when arriving from a "Enquire about this vehicle" link.
  useEffect(() => {
    if (initialVehicleId != null && vehicles.some((v) => v.id === initialVehicleId)) {
      selectVehicle(initialVehicleId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVehicleId, vehicles]);

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
        throw new Error(data?.error ?? "Could not send your message. Please try again.");
      }
      setDone(true);
    } catch (err: any) {
      setError(err?.message ?? "Could not send your message. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <CheckCircle2 className="h-12 w-12 text-[var(--accent)] mx-auto mb-3" />
        <h3 className="font-semibold text-slate-900 text-lg">Thank you</h3>
        <p className="text-sm text-slate-500 mt-1">
          Your message has been sent to {dealerName}. We'll be in touch soon.
        </p>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent";

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-sm">
      <div>
        <h2 className="font-semibold text-slate-900 text-lg">Send us a message</h2>
        <p className="text-sm text-slate-500 mt-0.5">Fill in the form and we'll get straight back to you.</p>
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
        <label htmlFor="contact-name" className="text-sm font-medium text-slate-700">Name *</label>
        <input
          id="contact-name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="contact-email" className="text-sm font-medium text-slate-700">Email</label>
          <input
            id="contact-email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="contact-phone" className="text-sm font-medium text-slate-700">Phone</label>
          <input
            id="contact-phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>
      <p className="text-xs text-slate-500 -mt-2">Please provide an email or phone number so we can reply.</p>
      {vehicles.length > 0 && (
        <div className="space-y-1">
          <label htmlFor="contact-vehicle" className="text-sm font-medium text-slate-700">
            Which car are you interested in?
          </label>
          <select
            id="contact-vehicle"
            value={vehicleId ?? ""}
            onChange={(e) => selectVehicle(e.target.value ? Number(e.target.value) : null)}
            className={inputClass}
          >
            <option value="">General enquiry</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {vehicleLabel(v)}
              </option>
            ))}
          </select>
        </div>
      )}
      {selectedVehicle && (
        <div className="space-y-1">
          <label htmlFor="contact-vehicle-details" className="text-sm font-medium text-slate-700">Vehicle</label>
          <textarea
            id="contact-vehicle-details"
            readOnly
            rows={4}
            value={vehicleDetails(selectedVehicle)}
            className={`${inputClass} resize-none bg-slate-50 text-slate-600`}
          />
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="contact-message" className="text-sm font-medium text-slate-700">Message *</label>
        <textarea
          id="contact-message"
          required
          rows={5}
          value={form.message}
          onChange={(e) => {
            setMessageTouched(true);
            setForm({ ...form, message: e.target.value });
          }}
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full inline-flex items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
      >
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Send message
      </button>
    </form>
  );
}

function LocationMap({ address, businessName }: { address: string; businessName: string }) {
  // We can't use a business-name search (it matched an unrelated Google Places
  // listing and showed that other business's review card), and an address-only
  // search shows the formatted address as the info-box heading. To show THIS
  // dealer's name as the heading we geocode the address to coordinates (free,
  // no API key, via OpenStreetMap Nominatim) and plot `lat,lng (Business Name)`,
  // which Google renders with the parenthesised label as the marker heading.
  const [coords, setCoords] = useState<{ lat: string; lon: string } | null>(null);
  // The Google Maps embed (and the geocode lookup that feeds it) are
  // non-essential third-party content, so we only load them once the visitor
  // has accepted cookies via the consent banner.
  const { status: consentStatus, accept } = useCookieConsent();
  const mapAllowed = consentStatus === "accepted";

  useEffect(() => {
    if (!mapAllowed || !address.trim()) return;
    let cancelled = false;
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
      address,
    )}`;
    fetch(url, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("geocode failed"))))
      .then((results: Array<{ lat: string; lon: string }>) => {
        if (!cancelled && results?.[0]) {
          setCoords({ lat: results[0].lat, lon: results[0].lon });
        }
      })
      .catch(() => {
        /* fall back to the address-based embed below */
      });
    return () => {
      cancelled = true;
    };
  }, [address, mapAllowed]);

  // Plot plain coordinates (no parenthesised label) so Google shows just the
  // pin — our own info box names the dealer, and a label here would render
  // Google's own small box peeking out behind ours.
  const query = coords
    ? encodeURIComponent(`${coords.lat},${coords.lon}`)
    : encodeURIComponent(address);
  // Our own info box, so it always names THIS dealer regardless of whether
  // Google has (or wrongly matches) a Places listing for the location.
  const directionsHref = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    address,
  )}`;

  if (!mapAllowed) {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
        <div className="flex h-72 flex-col items-center justify-center gap-3 p-6 text-center sm:h-80">
          <MapPin className="h-8 w-8 text-[var(--accent)]" />
          <div>
            <p className="text-sm font-semibold text-slate-900">{businessName}</p>
            {address.trim() && (
              <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-slate-600">
                {address}
              </p>
            )}
          </div>
          <p className="max-w-xs text-xs leading-relaxed text-slate-500">
            The interactive map is provided by Google and may set cookies. Accept
            cookies to load it, or open directions in a new tab instead.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={accept}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-95"
            >
              Accept cookies &amp; load map
            </button>
            <a
              href={directionsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
            >
              <MapPin className="h-3.5 w-3.5" /> Get directions
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
      <iframe
        title={`Map showing the location of ${businessName}`}
        src={`https://maps.google.com/maps?q=${query}&output=embed`}
        className="h-72 w-full sm:h-80"
        style={{ border: 0 }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
      <div className="pointer-events-none absolute left-3 top-3 max-w-[16rem]">
        <div className="pointer-events-auto rounded-xl bg-white/95 p-3 shadow-md ring-1 ring-slate-200 backdrop-blur">
          <p className="text-sm font-semibold text-slate-900">{businessName}</p>
          {address.trim() && (
            <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-slate-600">
              {address}
            </p>
          )}
          <a
            href={directionsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline"
          >
            <MapPin className="h-3.5 w-3.5" /> Get directions
          </a>
        </div>
      </div>
    </div>
  );
}

export default function ShowroomContact() {
  const [dealer, setDealer] = useState<ShowroomDealer | null>(null);
  const [vehicles, setVehicles] = useState<ShowroomVehicle[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Optional ?vehicle=<id> deep link from a "Enquire about this vehicle" button.
  const initialVehicleId = (() => {
    const raw = new URLSearchParams(window.location.search).get("vehicle");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  })();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${basePath}/api/showroom`);
        if (!res.ok) throw new Error();
        const json: ShowroomData = await res.json();
        if (!cancelled) {
          setDealer(json.dealer);
          setVehicles(json.vehicles ?? []);
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

  if (status === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>;
  }

  if (status === "error" || !dealer) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 text-center text-slate-500">
        Sorry, this page is currently unavailable. Please try again later.
      </div>
    );
  }

  if (!dealer.showroomEnabled) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col" style={accentVars(dealer)}>
        <ShowroomHeader dealer={dealer} />
        <div className="flex-1 flex items-center justify-center p-4 text-center text-slate-500">
          Our website is currently unavailable. Please contact us directly.
        </div>
        <ShowroomFooter dealer={dealer} />
      </div>
    );
  }

  const telHref = telHrefOf(dealer.phone);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" style={accentVars(dealer)}>
      <ShowroomHeader dealer={dealer} />

      {/* Page heading */}
      <section className="bg-[var(--bg)] text-[var(--bg-text)]">
        <div className="max-w-6xl mx-auto px-4 py-12 sm:py-16 w-full">
          <div className="max-w-2xl">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--bg-text)]">Contact us</h1>
            <p className="mt-3 text-base text-[var(--bg-text)] opacity-80">
              Have a question about a car, part-exchange or anything else?
              <br />
              Get in touch and a member of the team will be happy to help.
            </p>
          </div>
        </div>
      </section>

      <main className="flex-1 w-full">
        <section className="max-w-6xl mx-auto px-4 py-12 sm:py-16 w-full">
          <div className="grid gap-8 lg:grid-cols-2">
            <ContactForm
              dealerName={dealer.businessName}
              vehicles={vehicles}
              initialVehicleId={initialVehicleId}
            />

            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="font-semibold text-slate-900 text-lg">Get in touch</h2>
                <ul className="mt-4 space-y-4 text-sm">
                  {dealer.address && (
                    <li className="flex items-start gap-3">
                      <MapPin className="h-5 w-5 mt-0.5 text-[var(--accent)] shrink-0" />
                      <span className="whitespace-pre-line text-slate-700">{dealer.address}</span>
                    </li>
                  )}
                  {telHref && (
                    <li className="flex items-center gap-3">
                      <Phone className="h-5 w-5 text-[var(--accent)] shrink-0" />
                      <a href={telHref} className="text-slate-700 hover:text-slate-900">{dealer.phone}</a>
                    </li>
                  )}
                  {dealer.email && (
                    <li className="flex items-center gap-3">
                      <Mail className="h-5 w-5 text-[var(--accent)] shrink-0" />
                      <a href={`mailto:${dealer.email}`} className="text-slate-700 hover:text-slate-900 break-all">
                        {dealer.email}
                      </a>
                    </li>
                  )}
                </ul>
              </div>

              {dealer.address && (
                <LocationMap address={dealer.address} businessName={dealer.businessName} />
              )}
            </div>
          </div>
        </section>
      </main>

      <ShowroomFooter dealer={dealer} />
    </div>
  );
}
