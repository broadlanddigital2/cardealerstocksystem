import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import {
  ShowroomHeader,
  ShowroomFooter,
  accentVars,
  type ShowroomDealer,
  type ShowroomData,
} from "@/pages/Showroom";
import { showroomHref } from "@/lib/showroomHost";
import { reopenConsent } from "@/components/showroom/CookieConsent";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Shown on the policy pages. These are general templates for a UK used-car
// dealer, not legal advice — the dealership should review and adapt them.
const LAST_UPDATED = "June 2026";

function useDealer() {
  const [dealer, setDealer] = useState<ShowroomDealer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${basePath}/api/showroom`);
        if (!res.ok) throw new Error();
        const json: ShowroomData = await res.json();
        if (!cancelled) {
          setDealer(json.dealer);
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

  return { dealer, status };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-600">
        {children}
      </div>
    </section>
  );
}

function PolicyShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: (dealer: ShowroomDealer) => ReactNode;
}) {
  const { dealer, status } = useDealer();

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (status === "error" || !dealer) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 text-center text-slate-500">
        Sorry, this page is currently unavailable. Please try again later.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" style={accentVars(dealer)}>
      <ShowroomHeader dealer={dealer} />

      <section className="bg-[var(--bg)] text-[var(--bg-text)]">
        <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16 w-full">
          <Link href={showroomHref()}>
            <span className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-[var(--bg-text)] opacity-80 hover:opacity-100">
              <ArrowLeft className="h-4 w-4" /> Back to home
            </span>
          </Link>
          <h1 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight text-[var(--bg-text)]">
            {title}
          </h1>
          <p className="mt-3 text-base text-[var(--bg-text)] opacity-80">{intro}</p>
        </div>
      </section>

      <main className="flex-1 w-full">
        <section className="max-w-3xl mx-auto px-4 py-12 sm:py-16 w-full">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Last updated: {LAST_UPDATED}
          </p>
          <div className="mt-6">{children(dealer)}</div>
        </section>
      </main>

      <ShowroomFooter dealer={dealer} />
    </div>
  );
}

function contactLine(dealer: ShowroomDealer): ReactNode {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
      <p className="font-semibold text-slate-900">{dealer.businessName}</p>
      {dealer.address && (
        <p className="mt-1 whitespace-pre-line">{dealer.address}</p>
      )}
      {dealer.email && (
        <p className="mt-1">
          Email:{" "}
          <a
            href={`mailto:${dealer.email}`}
            className="font-medium text-[var(--accent)] hover:underline"
          >
            {dealer.email}
          </a>
        </p>
      )}
      {dealer.phone && <p className="mt-0.5">Phone: {dealer.phone}</p>}
      {dealer.companyNumber && (
        <p className="mt-1 text-xs text-slate-500">
          Company number: {dealer.companyNumber}
        </p>
      )}
    </div>
  );
}

export function ShowroomPrivacy() {
  return (
    <PolicyShell
      title="Privacy Policy"
      intro="How we collect, use and protect your personal information when you use this website or contact us."
    >
      {(dealer) => (
        <>
          <Section title="Who we are">
            <p>
              This website is operated by {dealer.businessName}
              {dealer.address ? `, ${dealer.address.replace(/\n/g, ", ")}` : ""}.
              We are the data controller responsible for your personal data. If you
              have any questions about this policy or how we handle your
              information, please contact us using the details below.
            </p>
            {contactLine(dealer)}
          </Section>

          <Section title="Information we collect">
            <p>We may collect and process the following information:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Details you provide when you make an enquiry through our contact
                form — typically your name, email address, telephone number, the
                vehicle you are interested in and the contents of your message.
              </li>
              <li>
                Information you give us by phone, email or in person, for example
                when arranging a viewing, test drive or part-exchange.
              </li>
              <li>
                Limited technical information collected automatically by your
                browser (such as your IP address) and, where you consent, by
                third-party content such as embedded maps. See our{" "}
                <Link href={showroomHref("/cookies")}>
                  <span className="cursor-pointer font-medium text-[var(--accent)] hover:underline">
                    Cookie Policy
                  </span>
                </Link>{" "}
                for details.
              </li>
            </ul>
          </Section>

          <Section title="How we use your information">
            <p>We use your personal data to:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>respond to your enquiries and provide the information you ask for;</li>
              <li>arrange vehicle viewings, test drives, sales and part-exchanges;</li>
              <li>keep records required for our business and accounting; and</li>
              <li>comply with our legal and regulatory obligations.</li>
            </ul>
          </Section>

          <Section title="Legal basis for processing">
            <p>
              We rely on our legitimate interests in responding to enquiries and
              running our business, on taking steps to enter into a contract with
              you where you are buying a vehicle, on your consent where you have
              given it (for example for non-essential cookies), and on compliance
              with legal obligations where applicable.
            </p>
          </Section>

          <Section title="Sharing your information">
            <p>
              We do not sell your personal data. We may share it with trusted
              service providers who help us operate (for example our website,
              email or finance providers), and with regulators, advisers or
              authorities where we are required to do so by law. Any providers who
              process data on our behalf are required to keep it secure and to use
              it only for the purposes we specify.
            </p>
          </Section>

          <Section title="How long we keep it">
            <p>
              We keep your personal data only for as long as necessary for the
              purposes set out above, including to meet any legal, accounting or
              reporting requirements, after which it is securely deleted.
            </p>
          </Section>

          <Section title="Your rights">
            <p>
              Under UK data protection law you have the right to access, correct,
              delete or restrict the use of your personal data, to object to its
              processing, and to data portability. To exercise any of these rights,
              please contact us using the details above. You also have the right to
              complain to the Information Commissioner's Office (ICO) at{" "}
              <a
                href="https://ico.org.uk"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[var(--accent)] hover:underline"
              >
                ico.org.uk
              </a>
              .
            </p>
          </Section>

          <Section title="Changes to this policy">
            <p>
              We may update this policy from time to time. Any changes will be
              posted on this page with a revised "last updated" date.
            </p>
          </Section>
        </>
      )}
    </PolicyShell>
  );
}

export function ShowroomCookies() {
  return (
    <PolicyShell
      title="Cookie Policy"
      intro="What cookies are, the cookies this website uses, and how you can control them."
    >
      {(dealer) => (
        <>
          <Section title="What are cookies?">
            <p>
              Cookies are small text files that a website can store on your device
              when you visit. They are widely used to make websites work, to
              improve your experience and to provide information to the site owner.
              Some content we embed from other companies may also use similar
              technologies.
            </p>
          </Section>

          <Section title="Cookies we use">
            <p>
              <span className="font-medium text-slate-900">Essential.</span> We
              store your cookie preference on your own device so we can remember
              your choice and respect it on future visits. This is required for the
              site to work as you expect and does not track you.
            </p>
            <p>
              <span className="font-medium text-slate-900">
                Non-essential (third-party).
              </span>{" "}
              Our contact page can display an interactive map provided by Google.
              When you allow it, Google may set its own cookies on your device.
              This map is only loaded after you have accepted cookies — if you
              reject non-essential cookies, the map is not loaded and you can still
              open directions in a new tab instead.
            </p>
          </Section>

          <Section title="Managing your choice">
            <p>
              You can change your decision at any time using the{" "}
              <button
                type="button"
                onClick={reopenConsent}
                className="font-medium text-[var(--accent)] hover:underline"
              >
                Cookie settings
              </button>{" "}
              option (also available in the footer of every page). You can also
              control or delete cookies through your browser settings; most
              browsers let you block or remove cookies, although doing so may
              affect how some websites function.
            </p>
          </Section>

          <Section title="More information">
            <p>
              For more about how we handle your personal information, please see our{" "}
              <Link href={showroomHref("/privacy")}>
                <span className="cursor-pointer font-medium text-[var(--accent)] hover:underline">
                  Privacy Policy
                </span>
              </Link>
              . If you have any questions about our use of cookies, please contact{" "}
              {dealer.businessName}
              {dealer.email ? (
                <>
                  {" "}
                  at{" "}
                  <a
                    href={`mailto:${dealer.email}`}
                    className="font-medium text-[var(--accent)] hover:underline"
                  >
                    {dealer.email}
                  </a>
                </>
              ) : null}
              .
            </p>
          </Section>
        </>
      )}
    </PolicyShell>
  );
}
