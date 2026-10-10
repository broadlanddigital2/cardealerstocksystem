import { Link } from "wouter";
import { Car, ShieldCheck, Calculator, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import logoUrl from "@assets/motormetric-logo.png";

const GREEN = "#6fa82f";

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-extrabold tracking-tight ${className}`}>
      <span style={{ color: GREEN }}>Motor</span>
      <span className="text-slate-900">Metric</span>
    </span>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          {/* soft green glow */}
          <div
            className="absolute inset-x-0 top-[-10%] h-[460px] blur-3xl"
            style={{ background: "radial-gradient(120% 100% at 50% 0%, rgba(111,168,47,0.18), transparent 70%)" }}
          />

          <div className="relative max-w-5xl mx-auto px-4 pt-4 pb-20 lg:pt-6 lg:pb-28 text-center">
            <img
              src={logoUrl}
              alt="MotorMetric by The Motor Trade Accountants"
              className="mx-auto h-64 lg:h-80 w-auto drop-shadow-sm"
            />

            <h1 className="mt-4 text-4xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.05]">
              Every motor,
              <br className="hidden sm:block" /> measured to the <span style={{ color: GREEN }}>metric</span>.
            </h1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
              <Wordmark className="text-lg lg:text-xl" /> is the intelligent stock book for UK motor dealers.
              Track every vehicle from purchase to sale and let us compute the VAT Margin Scheme figures —
              precision, compliance, and peace of mind.
            </p>

            <div className="mt-9 flex items-center justify-center gap-4">
              <Link href="/sign-in">
                <Button size="lg" className="h-12 px-8 text-base shadow-sm bg-[#4f7d23] hover:bg-[#456f1c] text-white">
                  Sign In <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>

            <div className="mt-14 grid md:grid-cols-3 gap-6 lg:gap-8 text-left">
              <FeatureCard
                icon={<Calculator size={22} />}
                title="Margin Scheme"
                body="Stay compliant with the VAT Margin Scheme for second-hand vehicles, keeping the records HMRC expects."
              />
              <FeatureCard
                icon={<ShieldCheck size={22} />}
                title="Invoices and Reports"
                body="Generate compliant sales invoices with the right wording built in. Export reports to PDF or CSV."
                muted
              />
              <FeatureCard
                icon={<Car size={22} />}
                title="Complete stock control"
                body="Track every vehicle from purchase to sale, with auto-generated stock numbers and full vehicle histories."
              />
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-black text-slate-400">
        <div className="max-w-6xl mx-auto px-6 lg:px-12 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
            <span className="font-extrabold tracking-tight text-lg">
              <span style={{ color: "#8DC63F" }}>Motor</span>
              <span className="text-white">Metric</span>
            </span>
            <p className="text-sm text-slate-400 mt-1">by The Motor Trade Accountants</p>
          </div>
          <p className="text-sm text-slate-400">
            &copy; {new Date().getFullYear()} The Motor Trade Accountants Limited. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
  muted = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  muted?: boolean;
}) {
  return (
    <div className="group bg-white p-7 rounded-2xl shadow-sm border border-slate-200 text-left transition hover:-translate-y-1 hover:shadow-md">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
        style={
          muted
            ? { backgroundColor: "rgba(15,23,42,0.06)", color: "#334155" }
            : { backgroundColor: "rgba(111,168,47,0.14)", color: "#5f9128" }
        }
      >
        {icon}
      </div>
      <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
      <p className="text-slate-600 leading-relaxed">{body}</p>
    </div>
  );
}
