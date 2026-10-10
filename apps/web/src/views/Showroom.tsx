import { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { formatCurrency } from "@/lib/format";
import { showroomHref } from "@/lib/showroomHost";
import { reopenConsent } from "@/components/showroom/CookieConsent";
import {
  Car,
  ImageOff,
  Phone,
  Mail,
  MapPin,
  Gauge,
  Palette,
  ArrowRight,
  ShieldCheck,
  Star,
} from "lucide-react";
const heroCars = "/assets/iStock-154962509_1781967272490.jpg";
const motorTradeLogo = "/assets/922892_Motor_Trade_LOGO_1780510240115.png";

const basePath = "";
export const DEFAULT_ACCENT = "#8DC63F";
export const DEFAULT_BG = "#0f172a";
export const DEFAULT_BG_TEXT = "#ffffff";

export interface ShowroomVehicle {
  id: number;
  make: string;
  model: string;
  registrationNumber: string | null;
  colour: string | null;
  mileage: number | null;
  askingPrice: number | null;
  marketingDescription: string | null;
  showroomSold: boolean;
  photoUrls: string[];
}

export interface ShowroomFeature {
  title: string;
  body: string;
  iconPath?: string;
}

export interface ShowroomReview {
  author: string;
  rating: number;
  text: string;
  date?: string;
}

export interface ShowroomDealer {
  businessName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoPath: string | null;
  businessType: string | null;
  companyName: string | null;
  companyNumber: string | null;
  placeOfRegistration: string | null;
  registeredOfficeAddress: string | null;
  vatNumber: string | null;
  financeProvided: boolean;
  financeFrnNumber: string | null;
  financeWording: string | null;
  accentColour: string | null;
  showroomEnabled: boolean;
  showroomHeadline: string | null;
  showroomIntro: string | null;
  showroomAboutTitle: string | null;
  showroomFeatures: ShowroomFeature[] | null;
  showroomReviews: ShowroomReview[] | null;
  backgroundColour: string | null;
  backgroundTextColour: string | null;
}

export interface ShowroomData {
  dealer: ShowroomDealer;
  vehicles: ShowroomVehicle[];
}

export function photoSrc(path: string) {
  return `${basePath}/api/storage${path}`;
}

export function accentVars(dealer: ShowroomDealer): React.CSSProperties {
  return {
    ["--accent" as any]: dealer.accentColour || DEFAULT_ACCENT,
    ["--bg" as any]: dealer.backgroundColour || DEFAULT_BG,
    ["--bg-text" as any]: dealer.backgroundTextColour || DEFAULT_BG_TEXT,
  };
}

function telHrefOf(phone: string | null) {
  return phone ? `tel:${phone.replace(/\s+/g, "")}` : null;
}

type VehicleSummary = {
  make: string;
  model: string;
  registrationNumber: string | null;
};

// Short one-line label used in dropdowns, e.g. "Ford Focus — AB12 CDE".
export function vehicleLabel(v: VehicleSummary): string {
  const name = [v.make, v.model].filter(Boolean).join(" ");
  return v.registrationNumber ? `${name} — ${v.registrationNumber}` : name;
}

// Multi-line summary shown in the read-only "vehicle" field on the enquiry forms.
export function vehicleDetails(v: VehicleSummary): string {
  const lines: string[] = [[v.make, v.model].filter(Boolean).join(" ")];
  if (v.registrationNumber) lines.push(`Registration: ${v.registrationNumber}`);
  return lines.join("\n");
}

// The auto-filled enquiry message when a specific vehicle is chosen.
export function vehicleEnquiryMessage(v: VehicleSummary): string {
  return `I'd like to enquire about the ${[v.make, v.model].filter(Boolean).join(" ")}. Is it still available?`;
}

export function ShowroomHeader({ dealer }: { dealer: ShowroomDealer }) {
  const telHref = telHrefOf(dealer.phone);
  useEffect(() => {
    if (dealer.businessName) {
      document.title = dealer.businessName;
    }
  }, [dealer.businessName]);
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="h-1 w-full bg-[var(--accent)]" />
      <div className="max-w-6xl mx-auto px-4 h-28 flex items-center gap-4">
        <Link href={showroomHref()}>
          <div className="flex items-center gap-3 cursor-pointer">
            {dealer.logoPath ? (
              <img src={photoSrc(dealer.logoPath)} alt={dealer.businessName} className="h-16 sm:h-24 w-auto object-contain" />
            ) : (
              <div className="h-12 w-12 rounded-lg bg-slate-100 flex items-center justify-center">
                <Car className="h-6 w-6 text-slate-400" />
              </div>
            )}
          </div>
        </Link>
        <nav className="ml-6 hidden md:flex items-center gap-7 text-lg font-medium text-slate-600">
          <Link href={showroomHref()}>
            <span className="cursor-pointer hover:text-slate-900">Home</span>
          </Link>
          <Link href={showroomHref("/stock")}>
            <span className="cursor-pointer hover:text-slate-900">Our Stock</span>
          </Link>
          <Link href={showroomHref("/contact")}>
            <span className="cursor-pointer hover:text-slate-900">Contact Us</span>
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href={showroomHref("/stock")}>
            <span className="md:hidden cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-900">
              Our Stock
            </span>
          </Link>
          <Link href={showroomHref("/contact")}>
            <span className="md:hidden cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-900">
              Contact Us
            </span>
          </Link>
          {telHref && (
            <a
              href={telHref}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-base sm:text-lg font-semibold text-white shadow-sm hover:brightness-95"
            >
              <Phone className="h-5 w-5" />
              <span className="hidden sm:inline">{dealer.phone}</span>
              <span className="sm:hidden">Call</span>
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

// Statutory business identifiers shown in the website footer. For a Limited
// Company this is company name + place of registration, company number, the
// registered office address (only when it differs from the trading address) and
// the VAT number. For any other business type, only the VAT number is shown.
function companyLegalLine(dealer: ShowroomDealer): string {
  const trimmed = (v: string | null) => (v ?? "").trim();
  const normalise = (v: string | null) =>
    trimmed(v).replace(/\s+/g, " ").toLowerCase();

  const segments: string[] = [];
  if (dealer.businessType === "Limited Company") {
    const name = trimmed(dealer.companyName) || trimmed(dealer.businessName);
    const place = trimmed(dealer.placeOfRegistration);
    if (name) {
      segments.push(place ? `${name} is registered in ${place}` : name);
    } else if (place) {
      segments.push(`Registered in ${place}`);
    }
    if (trimmed(dealer.companyNumber)) {
      segments.push(`Company No: ${trimmed(dealer.companyNumber)}`);
    }
    const regOffice = trimmed(dealer.registeredOfficeAddress);
    if (regOffice && normalise(dealer.registeredOfficeAddress) !== normalise(dealer.address)) {
      segments.push(`Registered Office: ${regOffice.replace(/\n/g, ", ")}`);
    }
  }
  if (trimmed(dealer.vatNumber)) {
    segments.push(`VAT Reg No: ${trimmed(dealer.vatNumber)}`);
  }
  return segments.join("  •  ");
}

export function ShowroomFooter({ dealer }: { dealer: ShowroomDealer }) {
  const telHref = telHrefOf(dealer.phone);
  const legalLine = companyLegalLine(dealer);
  return (
    <footer className="mt-16 bg-[var(--bg)] text-[var(--bg-text)]">
      {dealer.financeProvided && dealer.financeFrnNumber?.trim() && dealer.financeWording?.trim() && (
        <div className="border-b border-white/10">
          <div className="max-w-6xl mx-auto px-4 py-5 text-xs text-[var(--bg-text)] space-y-1.5">
            {dealer.financeFrnNumber?.trim() && (
              <p className="font-semibold text-[var(--bg-text)]">
                {dealer.businessName} is authorised and regulated by the Financial
                Conduct Authority. FRN: {dealer.financeFrnNumber.trim()}
              </p>
            )}
            {dealer.financeWording?.trim() && (
              <p className="whitespace-pre-line opacity-60">{dealer.financeWording.trim()}</p>
            )}
          </div>
        </div>
      )}
      <div className="max-w-6xl mx-auto px-4 py-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {dealer.logoPath ? (
              <img src={photoSrc(dealer.logoPath)} alt={dealer.businessName} className="h-9 w-auto object-contain bg-white rounded p-1" />
            ) : (
              <Car className="h-6 w-6 text-[var(--accent)]" />
            )}
            <span className="font-semibold text-[var(--bg-text)]">{dealer.businessName}</span>
          </div>
          <p className="text-sm text-[var(--bg-text)] opacity-60 max-w-xs">
            Quality used cars. Get in touch to arrange a viewing or test drive.
          </p>
          <div className="flex flex-col gap-2">
            <Link href={showroomHref("/contact")}>
              <span className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)] cursor-pointer hover:brightness-110">
                Contact us <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <div className="font-semibold text-[var(--bg-text)] uppercase tracking-wide text-xs mb-3">Contact</div>
          {telHref && (
            <a href={telHref} className="flex items-center gap-2 hover:opacity-70">
              <Phone className="h-4 w-4 text-[var(--accent)]" /> {dealer.phone}
            </a>
          )}
          {dealer.email && (
            <a href={`mailto:${dealer.email}`} className="flex items-center gap-2 hover:opacity-70">
              <Mail className="h-4 w-4 text-[var(--accent)]" /> {dealer.email}
            </a>
          )}
        </div>
        <div className="space-y-2 text-sm">
          <div className="font-semibold text-[var(--bg-text)] uppercase tracking-wide text-xs mb-3">Visit us</div>
          {dealer.address && (
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 mt-0.5 text-[var(--accent)] shrink-0" />
              <span className="whitespace-pre-line">{dealer.address}</span>
            </div>
          )}
        </div>
      </div>
      {legalLine && (
        <div className="border-t border-white/10">
          <div className="max-w-6xl mx-auto px-4 py-4 text-xs text-[var(--bg-text)] opacity-60 text-left">
            {legalLine}
          </div>
        </div>
      )}
      <div className="border-t border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--bg-text)] opacity-70">
          <Link href={showroomHref("/privacy")}>
            <span className="cursor-pointer hover:opacity-100">Privacy Policy</span>
          </Link>
          <Link href={showroomHref("/cookies")}>
            <span className="cursor-pointer hover:opacity-100">Cookie Policy</span>
          </Link>
          <button
            type="button"
            onClick={reopenConsent}
            className="cursor-pointer hover:opacity-100"
          >
            Cookie settings
          </button>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs text-[var(--bg-text)] opacity-50">
          <span>
            © {new Date().getFullYear()} The Motor Trade Accountants Limited. All rights reserved.
          </span>
          <div className="flex items-center gap-2">
            <span className="uppercase tracking-wide">Website provided by</span>
            <img
              src={motorTradeLogo}
              alt="The Motor Trade Accountants"
              className="h-8 w-auto object-contain bg-white rounded p-1"
            />
          </div>
        </div>
      </div>
    </footer>
  );
}

function SpecChip({ icon: Icon, label }: { icon: typeof Gauge; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      {label}
    </span>
  );
}

// Diagonal "SOLD" band drawn across a vehicle's main picture in the showroom.
// Position it inside a `relative` image container.
export function SoldBanner() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
      <span className="w-[150%] -rotate-12 bg-red-600/90 py-2 text-center text-2xl font-extrabold uppercase tracking-[0.35em] text-white shadow-lg">
        Sold
      </span>
    </div>
  );
}

export function VehicleCard({ v }: { v: ShowroomVehicle }) {
  return (
    <Link href={showroomHref(`/${v.id}`)}>
      <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl cursor-pointer">
        <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
          {v.photoUrls[0] ? (
            <img
              src={photoSrc(v.photoUrls[0])}
              alt={`${v.make} ${v.model}`}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageOff className="h-10 w-10 text-slate-300" />
            </div>
          )}
          {v.photoUrls.length > 1 && (
            <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
              {v.photoUrls.length} photos
            </span>
          )}
          {v.showroomSold && <SoldBanner />}
        </div>
        <div className="flex flex-1 flex-col p-5">
          <h3 className="font-semibold text-slate-900 leading-tight">
            {v.make} {v.model}
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {v.mileage != null && <SpecChip icon={Gauge} label={`${v.mileage.toLocaleString()} miles`} />}
            {v.colour && <SpecChip icon={Palette} label={v.colour} />}
          </div>
          <div className="mt-auto flex items-center justify-between pt-5">
            <span className="text-xl font-bold text-slate-900">
              {v.askingPrice != null ? formatCurrency(v.askingPrice) : "POA"}
            </span>
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent)]">
              View <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}

// Default icon for the "why buy from us" cards, shown whenever a dealer has not
// uploaded their own icon/picture for that card. ShieldCheck is the "tick"
// badge used consistently across all three cards by default.
const DEFAULT_FEATURE_ICON = ShieldCheck;

// Default copy shown when the dealer has not customised these fields. Exported so
// the Settings editor can show the same text as placeholders.
export function defaultShowroomIntro(businessName: string): string {
  const name = businessName.trim() || "us";
  return `Welcome to ${name}. Browse our latest selection of quality used vehicles and get in touch — we're here to help you find the right car.`;
}

export const DEFAULT_ABOUT_TITLE = "Why buy from us";

export const DEFAULT_FEATURES: ShowroomFeature[] = [
  {
    title: "Hand-picked stock",
    body: "Every car on our website is chosen for quality and value, ready to drive away.",
  },
  {
    title: "Honest, friendly service",
    body: "No pressure and no jargon — just straightforward help finding the right car for you.",
  },
  {
    title: "Easy to get in touch",
    body: "Send an enquiry online or give us a call, and we'll get straight back to you.",
  },
];

// Resolve the feature cards to render: use the dealer's saved features, falling
// back to defaults, and ignore any blank entries the dealer cleared out.
export function resolveShowroomFeatures(
  features: ShowroomFeature[] | null,
): ShowroomFeature[] {
  const cleaned = (features ?? [])
    .map((f) => ({
      title: (f.title ?? "").trim(),
      body: (f.body ?? "").trim(),
      ...(f.iconPath ? { iconPath: f.iconPath } : {}),
    }))
    .filter((f) => f.title || f.body);
  return cleaned.length > 0 ? cleaned : DEFAULT_FEATURES;
}

// Clean saved reviews for display: trim text, clamp the rating to 1-5, and drop
// any blank entries. Unlike the "why buy" cards there is no default fallback —
// the reviews section is simply hidden when the dealer has not added any.
export function resolveShowroomReviews(
  reviews: ShowroomReview[] | null,
): ShowroomReview[] {
  return (reviews ?? [])
    .map((r) => {
      const rating = Math.round(Number(r.rating));
      const date = (r.date ?? "").trim();
      return {
        author: (r.author ?? "").trim(),
        rating: Number.isFinite(rating) ? Math.min(5, Math.max(1, rating)) : 5,
        text: (r.text ?? "").trim(),
        ...(date ? { date } : {}),
      };
    })
    .filter((r) => r.text || r.author);
}

// A row of 5 stars, filled up to `rating`, using the dealer's accent colour.
function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={
            i < rating
              ? "h-4 w-4 fill-[var(--accent)] text-[var(--accent)]"
              : "h-4 w-4 fill-slate-200 text-slate-200"
          }
        />
      ))}
    </div>
  );
}

export default function Showroom() {
  const [data, setData] = useState<ShowroomData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

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

  const { dealer, vehicles } = data;

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

  const featured = vehicles.slice(0, 3);
  const reviews = resolveShowroomReviews(dealer.showroomReviews);
  const telHref = telHrefOf(dealer.phone);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" style={accentVars(dealer)}>
      <ShowroomHeader dealer={dealer} />

      {/* Hero */}
      <section className="relative overflow-hidden bg-[var(--bg)]">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${heroCars})` }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, var(--bg), color-mix(in srgb, var(--bg) 85%, transparent), color-mix(in srgb, var(--bg) 40%, transparent))",
          }}
        />
        <div
          className="absolute inset-0 opacity-25"
          style={{
            background:
              "radial-gradient(60% 120% at 85% 0%, var(--accent) 0%, transparent 55%), radial-gradient(50% 100% at 0% 100%, var(--accent) 0%, transparent 60%)",
          }}
        />
        <div className="relative max-w-6xl mx-auto px-4 py-20 sm:py-28">
          <h1 className="max-w-3xl text-4xl sm:text-5xl font-bold tracking-tight text-[var(--bg-text)]">
            {dealer.showroomHeadline || "Find your next car with confidence"}
          </h1>
          <p className="mt-4 max-w-xl text-base sm:text-lg text-[var(--bg-text)] opacity-80 whitespace-pre-line">
            {dealer.showroomIntro?.trim() || defaultShowroomIntro(dealer.businessName)}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href={showroomHref("/stock")}>
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:brightness-95 cursor-pointer">
                View our stock <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
            {telHref && (
              <a
                href={telHref}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/15"
              >
                <Phone className="h-4 w-4" /> {dealer.phone}
              </a>
            )}
          </div>
        </div>
      </section>

      <main className="flex-1">
        {/* Why choose us */}
        <section className="bg-white border-y border-slate-200">
          <div className="max-w-6xl mx-auto px-4 py-14">
            <h2 className="text-2xl font-bold text-slate-900 text-center">
              {dealer.showroomAboutTitle?.trim() || DEFAULT_ABOUT_TITLE}
            </h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-3">
              {resolveShowroomFeatures(dealer.showroomFeatures).map((p, i) => (
                <div key={i} className="flex flex-col items-center text-center rounded-2xl border border-slate-200 bg-slate-50 p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)]/15 overflow-hidden">
                    {p.iconPath ? (
                      <img
                        src={photoSrc(p.iconPath)}
                        alt={p.title || `Selling point ${i + 1}`}
                        className="h-full w-full object-contain p-1.5"
                      />
                    ) : (
                      <DEFAULT_FEATURE_ICON className="h-5 w-5 text-[var(--accent)]" />
                    )}
                  </div>
                  {p.title && <h3 className="mt-4 font-semibold text-slate-900">{p.title}</h3>}
                  {p.body && <p className="mt-1 text-sm text-slate-600">{p.body}</p>}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Featured stock */}
        {featured.length > 0 && (
          <section className="bg-[var(--bg)] text-[var(--bg-text)]">
            <div className="max-w-6xl mx-auto px-4 pt-14 pb-6 w-full">
              <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-2xl font-bold">Featured vehicles</h2>
                  <p className="opacity-80 mt-1 text-sm">A few of the cars available right now.</p>
                </div>
                <Link href={showroomHref("/stock")}>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/15 cursor-pointer">
                    View all stock <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              </div>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {featured.map((v) => (
                  <VehicleCard key={v.id} v={v} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Visit / contact CTA */}
        <section className="bg-[var(--bg)] text-[var(--bg-text)]">
          <div className="max-w-6xl mx-auto px-4 pt-6 pb-16">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold">Come and see us</h2>
              <p className="mt-3 text-[var(--bg-text)] opacity-80">
                Pop in to view our cars in person, or get in touch to arrange a test drive. We'd love to
                help you find your next car.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                {telHref && (
                  <a
                    href={telHref}
                    className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/15"
                  >
                    <Phone className="h-4 w-4" /> Call us
                  </a>
                )}
                <Link href={showroomHref("/contact")}>
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/15 cursor-pointer">
                    Contact us <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Customer reviews */}
        {reviews.length > 0 && (
          <section className="bg-slate-50 border-y border-slate-200">
            <div className="max-w-6xl mx-auto px-4 py-14">
              <h2 className="text-2xl font-bold text-slate-900 text-center">
                What our customers say
              </h2>
              <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {reviews.map((r, i) => (
                  <figure
                    key={i}
                    className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                  >
                    <StarRating rating={r.rating} />
                    {r.text && (
                      <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-slate-600">
                        “{r.text}”
                      </blockquote>
                    )}
                    {(r.author || r.date) && (
                      <figcaption className="mt-4 text-sm font-semibold text-slate-900">
                        {r.author}
                        {r.date && (
                          <span className="ml-2 font-normal text-slate-400">{r.date}</span>
                        )}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      <ShowroomFooter dealer={dealer} />
    </div>
  );
}
