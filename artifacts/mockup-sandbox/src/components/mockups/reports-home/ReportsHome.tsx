import {
  LayoutDashboard,
  Boxes,
  ShoppingCart,
  Gavel,
  Receipt,
  Landmark,
  AlertCircle,
  Wallet,
  PiggyBank,
  BookOpenCheck,
  ChevronRight,
  Search,
} from "lucide-react";

type Report = {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

type Group = {
  label: string;
  hint: string;
  reports: Report[];
};

const GROUPS: Group[] = [
  {
    label: "Overview",
    hint: "At-a-glance figures",
    reports: [
      {
        title: "Dashboard",
        description: "Headline VAT, margin and stock figures for the period.",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: "Stock & Purchases",
    hint: "What you've bought and hold",
    reports: [
      {
        title: "Stock Report",
        description: "Every vehicle currently in stock and its cost.",
        icon: Boxes,
      },
      {
        title: "Purchases Report",
        description: "All vehicles purchased within the date range.",
        icon: ShoppingCart,
      },
      {
        title: "Auction / Trade",
        description: "Purchase price plus auction & trade acquisition costs.",
        icon: Gavel,
      },
    ],
  },
  {
    label: "Sales & Customers",
    hint: "What you've sold and what's owed",
    reports: [
      {
        title: "Sales Report",
        description: "Sales, margin and VAT due under the margin scheme.",
        icon: Receipt,
      },
      {
        title: "Finance Report",
        description: "Vehicles sold via a finance company.",
        icon: Landmark,
      },
      {
        title: "Outstanding Report",
        description: "Invoiced amounts still unpaid by customers.",
        icon: AlertCircle,
      },
      {
        title: "Deposits Report",
        description: "Deposits taken against pending sales.",
        icon: PiggyBank,
      },
      {
        title: "Payments Report",
        description: "Customer payments received, by type and method.",
        icon: Wallet,
      },
    ],
  },
  {
    label: "Accounting",
    hint: "For the bookkeeper",
    reports: [
      {
        title: "Journal",
        description: "Double-entry journal lines ready for export.",
        icon: BookOpenCheck,
      },
    ],
  },
];

function ReportCard({ report }: { report: Report }) {
  const Icon = report.icon;
  return (
    <button className="group flex w-full items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#8DC63F] hover:shadow-md">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#8DC63F]/10 text-[#5f9128] transition-colors group-hover:bg-[#8DC63F] group-hover:text-white">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-semibold text-slate-900">{report.title}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-[#5f9128]" />
        </span>
        <span className="mt-1 block text-sm leading-snug text-slate-500">
          {report.description}
        </span>
      </span>
    </button>
  );
}

export function ReportsHome() {
  return (
    <div className="min-h-screen bg-slate-50 font-['Inter']">
      <div className="mx-auto max-w-6xl px-8 py-10">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Reports
            </h1>
            <p className="mt-1 text-slate-500">
              Choose a report to view, filter and export.
            </p>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              readOnly
              placeholder="Search reports…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-600 shadow-sm outline-none placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Groups */}
        <div className="mt-8 space-y-9">
          {GROUPS.map((group) => (
            <section key={group.label}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {group.label}
                </h2>
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-xs text-slate-400">{group.hint}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.reports.map((report) => (
                  <ReportCard key={report.title} report={report} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
