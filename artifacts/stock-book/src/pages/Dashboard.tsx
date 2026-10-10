import { useState } from "react";
import { useGetDashboardSummary, type DashboardDetailItem } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Car, PoundSterling, TrendingUp, ReceiptText, CalendarRange, AlertCircle } from "lucide-react";

type DetailView = {
  title: string;
  description: string;
  items: DashboardDetailItem[];
  totalLabel: string;
  totalDisplay: string;
};

export default function Dashboard() {
  const { data: summary, isLoading, error } = useGetDashboardSummary();
  const [detail, setDetail] = useState<DetailView | null>(null);

  if (isLoading) {
    return <div className="py-8 text-slate-500">Loading dashboard...</div>;
  }

  if (error || !summary) {
    return (
      <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2">
        <AlertCircle size={20} />
        Failed to load dashboard data.
      </div>
    );
  }

  const salesDetail = summary.salesThisMonthDetail ?? [];
  const netMarginDetail = summary.netMarginThisMonthDetail ?? [];
  const vatMonthDetail = summary.vatThisMonthDetail ?? [];
  const vatQuarterDetail = summary.vatThisQuarterDetail ?? [];
  const stockDetail = summary.stockDetail ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <DashboardCard
          title="Sales This Month"
          icon={<TrendingUp className="h-4 w-4 text-slate-400" />}
          value={<span className="text-slate-900">{summary.soldThisMonthCount}</span>}
          detailCount={salesDetail.length}
          onClick={() =>
            setDetail({
              title: "Sales This Month",
              description: "Vehicles sold this month, showing each sale price",
              items: salesDetail,
              totalLabel: "Vehicles sold",
              totalDisplay: String(summary.soldThisMonthCount),
            })
          }
        />
        <DashboardCard
          title="Net Margin This Month"
          icon={<TrendingUp className="h-4 w-4 text-slate-400" />}
          value={<span className="text-green-600">{formatCurrency(summary.netMarginThisMonth)}</span>}
          detailCount={netMarginDetail.length}
          onClick={() =>
            setDetail({
              title: "Net Margin This Month",
              description: "Net margin (after margin-scheme VAT) per vehicle sold this month",
              items: netMarginDetail,
              totalLabel: "Total",
              totalDisplay: formatCurrency(summary.netMarginThisMonth),
            })
          }
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <DashboardCard
          title="VAT This Month"
          icon={<ReceiptText className="h-4 w-4 text-slate-400" />}
          value={<span className="text-red-600">{formatCurrency(summary.vatDueThisMonth)}</span>}
          detailCount={vatMonthDetail.length}
          onClick={() =>
            setDetail({
              title: "VAT This Month",
              description: "Output VAT on sales less input VAT reclaimed on VAT-qualifying purchases",
              items: vatMonthDetail,
              totalLabel: "Total",
              totalDisplay: formatCurrency(summary.vatDueThisMonth),
            })
          }
        />
        <DashboardCard
          title="VAT This Quarter"
          icon={<CalendarRange className="h-4 w-4 text-slate-400" />}
          value={<span className="text-red-600">{formatCurrency(summary.vatDueThisQuarter)}</span>}
          subtitle={summary.vatQuarterLabel}
          detailCount={vatQuarterDetail.length}
          onClick={() =>
            setDetail({
              title: "VAT This Quarter",
              description: `${summary.vatQuarterLabel} — output VAT on sales less input VAT reclaimed on VAT-qualifying purchases`,
              items: vatQuarterDetail,
              totalLabel: "Total",
              totalDisplay: formatCurrency(summary.vatDueThisQuarter),
            })
          }
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <DashboardCard
          title="Vehicles in Stock"
          icon={<Car className="h-4 w-4 text-slate-400" />}
          value={<span className="text-slate-900">{summary.inStockCount}</span>}
          detailCount={stockDetail.length}
          onClick={() =>
            setDetail({
              title: "Vehicles in Stock",
              description: "Vehicles currently in stock, showing each purchase cost",
              items: stockDetail,
              totalLabel: "Vehicles in stock",
              totalDisplay: String(summary.inStockCount),
            })
          }
        />
        <DashboardCard
          title="Total Stock Value"
          icon={<PoundSterling className="h-4 w-4 text-slate-400" />}
          value={<span className="text-slate-900">{formatCurrency(summary.totalStockValue)}</span>}
          detailCount={stockDetail.length}
          onClick={() =>
            setDetail({
              title: "Total Stock Value",
              description: "Purchase cost of each vehicle currently in stock",
              items: stockDetail,
              totalLabel: "Total",
              totalDisplay: formatCurrency(summary.totalStockValue),
            })
          }
        />
      </div>

      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
            <DialogDescription>{detail?.description}</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="max-h-[60vh] overflow-y-auto">
              {detail.items.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  No items to show.
                </p>
              ) : (
                <>
                  <ul className="divide-y divide-slate-100">
                    {detail.items.map((item) => (
                      <li key={item.id} className="flex items-start justify-between gap-4 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">{item.label}</p>
                          {item.sublabel && (
                            <p className="text-xs text-slate-500">{item.sublabel}</p>
                          )}
                        </div>
                        <span
                          className={`shrink-0 text-sm font-semibold tabular-nums ${
                            item.amount < 0 ? "text-red-600" : "text-slate-900"
                          }`}
                        >
                          {formatCurrency(item.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-3 mt-1">
                    <span className="text-sm font-semibold text-slate-700">{detail.totalLabel}</span>
                    <span className="text-sm font-bold tabular-nums text-slate-900">
                      {detail.totalDisplay}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DashboardCard({
  title,
  icon,
  value,
  subtitle,
  detailCount,
  onClick,
}: {
  title: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  subtitle?: string;
  detailCount: number;
  onClick: () => void;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="cursor-pointer transition-shadow hover:shadow-md hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-slate-500">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
        <p className="text-xs text-slate-400 mt-2">
          {detailCount === 0 ? "No details" : "Click to view details"}
        </p>
      </CardContent>
    </Card>
  );
}
