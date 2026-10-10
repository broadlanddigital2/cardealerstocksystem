import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useGetStockReport,
  useGetPurchasesReport,
  useGetSalesReport,
  useGetDepositsReport,
  useGetSettings,
  useListInvoices,
  useListVehicles,
  getGetStockReportQueryKey,
  getGetPurchasesReportQueryKey,
  getGetSalesReportQueryKey,
  getGetDepositsReportQueryKey,
} from "@workspace/api-client-react";
import {
  FileDown,
  FileText,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Search,
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
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  buildJournalRows,
  buildPurchasesCsvRows,
  journalLineToCsvRow,
  toCsv,
  JOURNAL_CSV_HEADERS,
  PURCHASES_CSV_HEADERS,
} from "@workspace/report-calc";
import { deriveFinancePayment } from "@/lib/financePayment";
import Dashboard from "@/pages/Dashboard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";

function StockNumber({ value }: { value: string }) {
  const match = /^(\D*)(\d.*)$/.exec(value ?? "");
  if (!match) return <>{value}</>;
  return (
    <>
      <div>{match[1]}</div>
      <div>{match[2]}</div>
    </>
  );
}

type ReportTab =
  | "dashboard"
  | "stock"
  | "purchases"
  | "auction"
  | "sales"
  | "finance"
  | "outstanding"
  | "payments"
  | "deposits"
  | "journal";

type TabState = ReportTab | "home";

function reportLabel(tab: ReportTab): string {
  if (tab === "auction") return "Auction/Trade";
  if (tab === "dashboard" || tab === "journal") return tab.charAt(0).toUpperCase() + tab.slice(1);
  return `${tab.charAt(0).toUpperCase() + tab.slice(1)} Report`;
}

const DEFAULT_ACCENT = "#8DC63F";

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return `rgba(141, 198, 63, ${alpha})`;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function darken(hex: string, amount: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return "rgb(92, 129, 41)";
  const int = parseInt(m[1], 16);
  const r = Math.round(((int >> 16) & 255) * (1 - amount));
  const g = Math.round(((int >> 8) & 255) * (1 - amount));
  const b = Math.round((int & 255) * (1 - amount));
  return `rgb(${r}, ${g}, ${b})`;
}

type ReportCardItem = {
  tab: ReportTab;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

type ReportGroup = {
  label: string;
  hint: string;
  reports: ReportCardItem[];
};

const REPORT_GROUPS: ReportGroup[] = [
  {
    label: "Overview",
    hint: "At-a-glance figures",
    reports: [
      { tab: "dashboard", title: "Dashboard", description: "Headline VAT, margin and stock figures for the period.", icon: LayoutDashboard },
    ],
  },
  {
    label: "Stock & Purchases",
    hint: "What you've bought and hold",
    reports: [
      { tab: "stock", title: "Stock Report", description: "Every vehicle currently in stock and its cost.", icon: Boxes },
      { tab: "purchases", title: "Purchases Report", description: "All vehicles purchased within the date range.", icon: ShoppingCart },
      { tab: "auction", title: "Auction / Trade", description: "Purchase price plus auction & trade acquisition costs.", icon: Gavel },
    ],
  },
  {
    label: "Sales & Customers",
    hint: "What you've sold and what's owed",
    reports: [
      { tab: "sales", title: "Sales Report", description: "Sales, margin and VAT due under the margin scheme.", icon: Receipt },
      { tab: "finance", title: "Finance Report", description: "Vehicles sold via a finance company.", icon: Landmark },
      { tab: "outstanding", title: "Outstanding Report", description: "Invoiced amounts still unpaid by customers.", icon: AlertCircle },
      { tab: "deposits", title: "Deposits Report", description: "Deposits taken against pending sales.", icon: PiggyBank },
      { tab: "payments", title: "Payments Report", description: "Customer payments received, by type and method.", icon: Wallet },
    ],
  },
  {
    label: "Accounting",
    hint: "For the bookkeeper",
    reports: [
      { tab: "journal", title: "Journal", description: "Double-entry journal lines ready for export.", icon: BookOpenCheck },
    ],
  },
];

function ReportsLanding({ onSelect }: { onSelect: (tab: ReportTab) => void }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();

  const groups = REPORT_GROUPS.map(group => ({
    ...group,
    reports: query
      ? group.reports.filter(r =>
          r.title.toLowerCase().includes(query) || r.description.toLowerCase().includes(query)
        )
      : group.reports,
  })).filter(group => group.reports.length > 0);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="mt-1 text-slate-500">Choose a report to view, filter and export.</p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search reports…"
            className="pl-9"
          />
        </div>
      </div>

      <div className="mt-8 space-y-9">
        {groups.length === 0 ? (
          <p className="text-slate-500">No reports match “{search}”.</p>
        ) : (
          groups.map(group => (
            <section key={group.label}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{group.label}</h2>
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-xs text-slate-400">{group.hint}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.reports.map(report => {
                  const Icon = report.icon;
                  return (
                    <button
                      key={report.tab}
                      onClick={() => onSelect(report.tab)}
                      className="report-card group flex w-full items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <span className="report-card-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">{report.title}</span>
                          <ChevronRight className="report-card-chevron h-4 w-4 shrink-0 text-slate-300 transition-colors" />
                        </span>
                        <span className="mt-1 block text-sm leading-snug text-slate-500">{report.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

export default function Reports() {
  const [activeTab, setActiveTab] = useState<TabState>("home");
  
  // Date params
  const [stockDate, setStockDate] = useState(new Date().toISOString().split('T')[0]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);

  // Payments report filters
  const [regFilter, setRegFilter] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [paymentTypeFilter, setPaymentTypeFilter] = useState("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const [purchaseTypeFilter, setPurchaseTypeFilter] = useState<string[]>([]);
  const [auctionTradeFilter, setAuctionTradeFilter] = useState<"all" | "auction" | "trade">("all");

  const { data: stockReport, isLoading: loadingStock } = useGetStockReport(
    { date: stockDate },
    {
      query: {
        enabled: activeTab === "stock",
        queryKey: getGetStockReportQueryKey({ date: stockDate }),
      },
    }
  );

  const { data: purchasesReport, isLoading: loadingPurchases } = useGetPurchasesReport(
    { from: fromDate || undefined, to: toDate || undefined },
    {
      query: {
        enabled: activeTab === "purchases" || activeTab === "auction",
        queryKey: getGetPurchasesReportQueryKey({
          from: fromDate || undefined,
          to: toDate || undefined,
        }),
      },
    }
  );

  const { data: salesReport, isLoading: loadingSales } = useGetSalesReport(
    { from: fromDate || undefined, to: toDate || undefined },
    {
      query: {
        enabled:
          activeTab === "sales" ||
          activeTab === "journal" ||
          activeTab === "finance",
        queryKey: getGetSalesReportQueryKey({
          from: fromDate || undefined,
          to: toDate || undefined,
        }),
      },
    }
  );

  const { data: depositsReport, isLoading: loadingDeposits } = useGetDepositsReport(
    { from: fromDate || undefined, to: toDate || undefined },
    {
      query: {
        enabled: activeTab === "deposits",
        queryKey: getGetDepositsReportQueryKey({
          from: fromDate || undefined,
          to: toDate || undefined,
        }),
      },
    }
  );

  const { data: invoices, isLoading: loadingInvoices } = useListInvoices();
  const { data: invoiceVehicles } = useListVehicles();
  const { data: settings } = useGetSettings();

  // Sales report rows augmented with their invoice extras (net + VAT). Extras
  // are billed on a separate standard-VAT invoice, so they are shown alongside
  // the margin-scheme figures rather than folded into the car's VAT Due.
  const salesRows = (salesReport ?? []).map((v) => {
    const inv = (invoices ?? []).find((i) => i.vehicleId === v.id);
    const extrasNet = (inv?.extras ?? []).reduce((s, ex) => s + ex.amount, 0);
    const extrasVat = (inv?.extras ?? []).reduce((s, ex) => s + (ex.vat ?? 0), 0);
    return { ...v, extrasNet, extrasVat };
  });

  // Cars sold on finance: sold vehicles whose linked invoice has a finance
  // company recorded. The finance company funds the purchase, so it is shown
  // alongside the buyer (who takes delivery of the car).
  const financeRows = (salesReport ?? [])
    .map((v) => {
      const inv = (invoices ?? []).find((i) => i.vehicleId === v.id);
      return {
        ...v,
        financeCompanyName: inv?.financeCompanyName ?? null,
        buyerName: v.buyerName ?? "",
      };
    })
    .filter((v) => (v.financeCompanyName ?? "").trim() !== "");

  // Outstanding amounts: for each sold vehicle, what the customer still owes.
  // Total invoiced = sale price + invoice extras (incl. their VAT).
  // Total paid = holding deposit + part-exchange allowance + payment schedule
  // (payments to the customer are subtracted). Mirrors the Payments tab.
  const loadingOutstanding = loadingInvoices || !invoiceVehicles;
  const outstandingRows = (invoiceVehicles ?? [])
    .filter((v) => v.status === "sold" && v.salePrice != null)
    .filter((v) => {
      if (fromDate && (v.saleDate ?? "") < fromDate) return false;
      if (toDate && (v.saleDate ?? "") > toDate) return false;
      return true;
    })
    .map((v) => {
      const inv = (invoices ?? []).find((i) => i.vehicleId === v.id);
      const extrasTotal = (inv?.extras ?? []).reduce(
        (s, ex) => s + ex.amount + (ex.vat ?? 0),
        0,
      );
      // Include sale VAT for VAT-qualifying vehicles so the invoiced total stays
      // consistent with balancePayable (which includes VAT) when summing payments.
      const saleVatTotal =
        v.vatQualifying && v.saleVat != null ? Number(v.saleVat) : 0;
      const totalInvoiced = (v.salePrice ?? 0) + saleVatTotal + extrasTotal;
      let totalPaid = 0;
      if (v.holdingDepositAmount != null && v.holdingDepositAmount > 0)
        totalPaid += v.holdingDepositAmount;
      if (v.partExchangeAllowance != null && v.partExchangeAllowance > 0)
        totalPaid += v.partExchangeAllowance;
      // On a finance sale the finance company settles the balance payable; that
      // is derived from the invoice rather than stored, mirroring the Payments tab.
      const financePayment = deriveFinancePayment({
        financeCompanyName: inv?.financeCompanyName,
        balancePayable: inv?.balancePayable,
        saleDate: v.saleDate,
      });
      if (financePayment) totalPaid += financePayment.amount;
      for (const p of v.payments ?? []) {
        // Skip stored "Finance" rows when we derive one, to avoid double-counting.
        if (financePayment && p.paymentMethod === "Finance") continue;
        const amt = Number(p.amount) || 0;
        totalPaid += p.type === "Payment to Customer" ? -amt : amt;
      }
      return {
        id: v.id,
        stockNumber: v.stockNumber,
        registrationNumber: v.registrationNumber,
        make: v.make,
        model: v.model,
        customerName: v.buyerName ?? "",
        saleDate: v.saleDate ?? null,
        totalInvoiced,
        totalPaid,
        outstanding: totalInvoiced - totalPaid,
      };
    })
    .filter((r) => r.outstanding > 0.005)
    .sort((a, b) => b.outstanding - a.outstanding);

  const outstandingTotal = outstandingRows.reduce((s, r) => s + r.outstanding, 0);
  const outstandingInvoicedTotal = outstandingRows.reduce((s, r) => s + r.totalInvoiced, 0);
  const outstandingPaidTotal = outstandingRows.reduce((s, r) => s + r.totalPaid, 0);

  // Payments report: one row per individual payment across all vehicles.
  // Mirrors the vehicle Payments tab schedule — holding deposit, part-exchange
  // allowance, derived finance settlement, and manual payment entries. Payments
  // to the customer are shown as negative so the totals reconcile.
  const loadingPayments = loadingInvoices || !invoiceVehicles;
  const paymentRows = (invoiceVehicles ?? []).flatMap((v) => {
    const inv = (invoices ?? []).find((i) => i.vehicleId === v.id);
    const financePayment = deriveFinancePayment({
      financeCompanyName: inv?.financeCompanyName,
      balancePayable: inv?.balancePayable,
      saleDate: v.saleDate,
    });
    const entries: { date: string; amount: number; paymentMethod: string; type: string }[] = [];
    if (v.holdingDepositAmount != null && v.holdingDepositAmount > 0)
      entries.push({ date: v.holdingDepositDate ?? "", amount: v.holdingDepositAmount, paymentMethod: v.holdingDepositPaymentMethod ?? "", type: "Deposit" });
    if (v.partExchangeAllowance != null && v.partExchangeAllowance > 0)
      entries.push({ date: v.saleDate ?? "", amount: v.partExchangeAllowance, paymentMethod: "Part Exchange", type: "Part Exchange" });
    if (financePayment) entries.push(financePayment);
    for (const p of v.payments ?? []) {
      // Skip stored "Finance" rows when we derive one, to avoid double-counting.
      if (financePayment && p.paymentMethod === "Finance") continue;
      entries.push({ date: p.date ?? "", amount: Number(p.amount) || 0, paymentMethod: p.paymentMethod ?? "", type: p.type ?? "" });
    }
    return entries.map((e) => ({
      vehicleId: v.id,
      stockNumber: v.stockNumber,
      registrationNumber: v.registrationNumber,
      make: v.make,
      model: v.model,
      date: e.date,
      type: e.type,
      paymentMethod: e.paymentMethod,
      amount: e.type === "Payment to Customer" ? -e.amount : e.amount,
    }));
  });

  const paymentTypeOptions = Array.from(
    new Set(paymentRows.map((r) => r.type).filter((t) => t)),
  ).sort();

  const paymentMethodOptions = Array.from(
    new Set(paymentRows.map((r) => r.paymentMethod).filter((m) => m)),
  ).sort();

  const filteredPaymentRows = paymentRows
    .filter((r) => {
      if (fromDate && (r.date || "") < fromDate) return false;
      if (toDate && (r.date || "") > toDate) return false;
      if (regFilter && !r.registrationNumber.toLowerCase().includes(regFilter.toLowerCase())) return false;
      if (stockFilter && !r.stockNumber.toLowerCase().includes(stockFilter.toLowerCase())) return false;
      if (amountMin !== "" && Math.abs(r.amount) < Number(amountMin)) return false;
      if (amountMax !== "" && Math.abs(r.amount) > Number(amountMax)) return false;
      if (paymentTypeFilter !== "all" && r.type !== paymentTypeFilter) return false;
      if (paymentMethodFilter !== "all" && r.paymentMethod !== paymentMethodFilter) return false;
      return true;
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const paymentsTotal = filteredPaymentRows.reduce((s, r) => s + r.amount, 0);

  // Journal postings for the Journal tab and its Xero Sales Invoice CSV
  // export. The row generation lives in @workspace/report-calc so it can be
  // unit-tested (column layout, double-entry balance, empty TaxAmount on
  // No-VAT lines).
  const journalRows = buildJournalRows(salesReport ?? [], invoices ?? [], settings);

  const PURCHASE_TYPE_LABELS: Record<string, string> = {
    private: "Private",
    trade: "Trade",
    auction: "Auction",
    part_exchange: "Part Exchange",
    other: "Other",
    cazoo_import: "Cazoo Import",
  };
  const purchaseTypeLabel = (t?: string | null) =>
    t ? PURCHASE_TYPE_LABELS[t] ?? t : "—";
  const togglePurchaseType = (t: string) =>
    setPurchaseTypeFilter((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  const filteredPurchases = (purchasesReport ?? []).filter(
    (v) =>
      purchaseTypeFilter.length === 0 ||
      purchaseTypeFilter.includes(v.purchaseType ?? ""),
  );

  // Auction/Trade report: cars bought at auction or from the trade, with their
  // purchase price and acquisition (auction) costs broken out. Reuses the
  // purchases data (same date range) so no extra backend call is needed.
  const auctionRowTotal = (v: {
    purchasePrice: number;
    auctionCostNoVat?: number | null;
    auctionCostWithVat?: number | null;
  }) => v.purchasePrice + (v.auctionCostNoVat ?? 0) + (v.auctionCostWithVat ?? 0);
  const auctionTradeRows = (purchasesReport ?? []).filter((v) => {
    const t = v.purchaseType ?? "";
    if (t !== "auction" && t !== "trade") return false;
    if (auctionTradeFilter !== "all" && t !== auctionTradeFilter) return false;
    return true;
  });

  const downloadPurchasesCsv = () => {
    const rows = buildPurchasesCsvRows(
      filteredPurchases,
      settings?.stockCode ?? "",
      formatDate,
    );
    const csv = toCsv(PURCHASES_CSV_HEADERS, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Purchases.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadJournalCsv = () => {
    const rows = journalRows.map((l) => journalLineToCsvRow(l, formatDate));
    const csv = toCsv(JOURNAL_CSV_HEADERS, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Journal.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = (title: string, headers: string[][], body: any[][]) => {
    const doc = new jsPDF();
    doc.text(title, 14, 15);
    autoTable(doc, {
      startY: 25,
      head: headers,
      body: body,
      theme: 'striped'
    });
    doc.save(`${title.replace(/\s+/g, '_')}.pdf`);
  };

  const exportExcel = async (title: string, data: any[]) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Report");
    if (data.length > 0) {
      ws.columns = Object.keys(data[0]).map(key => ({ header: key, key }));
      data.forEach(row => ws.addRow(row));
    }
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "_")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const accent = DEFAULT_ACCENT;
  const accentVars = {
    ["--ac"]: accent,
    ["--ac-tint"]: hexToRgba(accent, 0.12),
    ["--ac-text"]: darken(accent, 0.35),
  } as React.CSSProperties;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6" style={accentVars}>
      {activeTab === "home" ? (
        <ReportsLanding onSelect={setActiveTab} />
      ) : (
      <>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="-ml-2 text-slate-600" onClick={() => setActiveTab("home")}>
          <ChevronLeft className="h-4 w-4 mr-1" /> All reports
        </Button>
        <span className="text-slate-300">/</span>
        <h1 className="text-2xl font-bold text-slate-900">{reportLabel(activeTab)}</h1>
      </div>

      {activeTab === "dashboard" ? (
        <Dashboard />
      ) : activeTab === "journal" ? (
        <Card>
          <CardHeader className="pb-2 border-b">
            <div className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Journal</CardTitle>
                <CardDescription>Accounting journal postings. CSV downloads in Xero's Sales Invoice import format.</CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label>From:</Label>
                  <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-auto" />
                </div>
                <div className="flex items-center gap-2">
                  <Label>To:</Label>
                  <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-auto" />
                </div>
                <Button variant="outline" size="sm" onClick={downloadJournalCsv}>
                  <FileDown className="h-4 w-4 mr-2" /> CSV
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice Number</TableHead>
                    <TableHead>Invoice Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Tax Rate</TableHead>
                    <TableHead className="text-right">Tax Amount</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeTab === "journal" && loadingSales && <TableRow><TableCell colSpan={9} className="text-center py-4">Loading...</TableCell></TableRow>}
                  {!loadingSales && journalRows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-4 text-slate-500">No journal entries.</TableCell></TableRow>}
                  {journalRows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.invoiceNumber || "—"}</TableCell>
                      <TableCell>{r.invoiceDate ? formatDate(r.invoiceDate) : "—"}</TableCell>
                      <TableCell>{r.description}</TableCell>
                      <TableCell className="text-right">{r.qty}</TableCell>
                      <TableCell className="text-right">{r.price === "" ? "" : formatCurrency(Number(r.price))}</TableCell>
                      <TableCell>{r.account || "—"}</TableCell>
                      <TableCell>{r.taxRate}</TableCell>
                      <TableCell className="text-right">{r.taxAmount === "" ? "" : formatCurrency(Number(r.taxAmount))}</TableCell>
                      <TableCell className="text-right">{r.amount === "" ? "" : formatCurrency(Number(r.amount))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : activeTab === "payments" ? (
        <Card>
          <CardHeader className="pb-2 border-b">
            <div className="flex flex-col gap-4">
              <div className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Payments Report</CardTitle>
                  <CardDescription>Every payment across your stock — deposits, part-exchanges, finance settlements and scheduled payments. Payments to the customer show as negative.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => exportPDF("Payments Report", [["Date", "Stock No", "Reg", "Make/Model", "Type", "Method", "Amount"]], filteredPaymentRows.map(r => [r.date ? formatDate(r.date) : "—", r.stockNumber, r.registrationNumber, `${r.make} ${r.model}`, r.type || "—", r.paymentMethod || "—", formatCurrency(r.amount)]))}>
                    <FileText className="h-4 w-4 mr-2" /> PDF
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => exportExcel("Payments Report", filteredPaymentRows.map(r => ({ date: r.date, stockNumber: r.stockNumber, registrationNumber: r.registrationNumber, makeModel: `${r.make} ${r.model}`, type: r.type, paymentMethod: r.paymentMethod, amount: r.amount })))}>
                    <FileDown className="h-4 w-4 mr-2" /> Excel
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-auto" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-auto" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Reg</Label>
                  <Input value={regFilter} onChange={e => setRegFilter(e.target.value)} placeholder="Any" className="w-32" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Stock No</Label>
                  <Input value={stockFilter} onChange={e => setStockFilter(e.target.value)} placeholder="Any" className="w-32" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Min £</Label>
                  <Input type="number" step="0.01" value={amountMin} onChange={e => setAmountMin(e.target.value)} placeholder="0" className="w-24" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Max £</Label>
                  <Input type="number" step="0.01" value={amountMax} onChange={e => setAmountMax(e.target.value)} placeholder="Any" className="w-24" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Payment Type</Label>
                  <Select value={paymentTypeFilter} onValueChange={setPaymentTypeFilter}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {paymentTypeOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Payment Method</Label>
                  <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All methods</SelectItem>
                      {paymentMethodOptions.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Stock No.</TableHead>
                    <TableHead>Reg</TableHead>
                    <TableHead>Make/Model</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPayments && <TableRow><TableCell colSpan={7} className="text-center py-4">Loading...</TableCell></TableRow>}
                  {!loadingPayments && filteredPaymentRows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-4 text-slate-500">No payments match the selected filters.</TableCell></TableRow>}
                  {filteredPaymentRows.map((r, i) => (
                    <TableRow key={`${r.vehicleId}-${r.date}-${r.type}-${r.paymentMethod}-${r.amount}-${i}`}>
                      <TableCell>{r.date ? formatDate(r.date) : "—"}</TableCell>
                      <TableCell><Link href={`/vehicles/${r.vehicleId}`} className="hover:underline font-medium" style={{ color: "var(--ac-text)" }}><StockNumber value={r.stockNumber} /></Link></TableCell>
                      <TableCell>{r.registrationNumber}</TableCell>
                      <TableCell><div>{r.make}</div><div className="text-slate-500">{r.model}</div></TableCell>
                      <TableCell>{r.type || "—"}</TableCell>
                      <TableCell>{r.paymentMethod || "—"}</TableCell>
                      <TableCell className={`text-right font-medium ${r.amount < 0 ? "text-red-600" : ""}`}>{r.amount < 0 ? `(${formatCurrency(Math.abs(r.amount))})` : formatCurrency(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {filteredPaymentRows.length > 0 && (
                    <TableRow className="border-t-2 font-medium">
                      <TableCell colSpan={6} className="text-right text-slate-500">Total</TableCell>
                      <TableCell className="text-right">{formatCurrency(paymentsTotal)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
          <div className="flex items-center gap-4">
            {activeTab === "stock" ? (
              <div className="flex items-center gap-2">
                <Label>Stock at date:</Label>
                <Input type="date" value={stockDate} onChange={e => setStockDate(e.target.value)} className="w-auto" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Label>From:</Label>
                  <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-auto" />
                </div>
                <div className="flex items-center gap-2">
                  <Label>To:</Label>
                  <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-auto" />
                </div>
              </>
            )}
            {activeTab === "purchases" && (
              <div className="flex items-center gap-2">
                <Label>Type:</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="w-[180px] justify-between font-normal">
                      <span className="truncate">
                        {purchaseTypeFilter.length === 0
                          ? "All types"
                          : purchaseTypeFilter.map(purchaseTypeLabel).join(", ")}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[180px]">
                    {Object.entries(PURCHASE_TYPE_LABELS).map(([value, label]) => (
                      <DropdownMenuCheckboxItem
                        key={value}
                        checked={purchaseTypeFilter.includes(value)}
                        onCheckedChange={() => togglePurchaseType(value)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            {activeTab === "auction" && (
              <div className="flex items-center gap-2">
                <Label>Source:</Label>
                <Select value={auctionTradeFilter} onValueChange={(v) => setAuctionTradeFilter(v as "all" | "auction" | "trade")}>
                  <SelectTrigger className="w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Auction &amp; Trade</SelectItem>
                    <SelectItem value="auction">Auction only</SelectItem>
                    <SelectItem value="trade">Trade only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {activeTab === 'purchases' && (
              <Button variant="outline" size="sm" onClick={downloadPurchasesCsv}>
                <FileDown className="h-4 w-4 mr-2" /> CSV
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => {
              if (activeTab === 'stock' && stockReport) {
                exportPDF("Stock Report", [['Stock No', 'Reg', 'Make', 'Model', 'Purchase Date', 'Cost']], stockReport.map(v => [v.stockNumber, v.registrationNumber, v.make, v.model, formatDate(v.purchaseDate), v.totalPurchaseCost.toString()]));
              } else if (activeTab === 'purchases' && filteredPurchases.length) {
                exportPDF("Purchases Report", [['Stock No', 'Reg', 'Make/Model', 'Purchased', 'Purchase Price', 'Type']], filteredPurchases.map(v => [v.stockNumber, v.registrationNumber, `${v.make} ${v.model}`, formatDate(v.purchaseDate), formatCurrency(v.totalPurchaseCost), purchaseTypeLabel(v.purchaseType)]));
              } else if (activeTab === 'auction' && auctionTradeRows.length) {
                exportPDF("Auction & Trade Report", [['Stock No', 'Reg', 'Make/Model', 'Purchased', 'Type', 'Purchase Price', 'Costs (No VAT)', 'Costs (inc VAT)', 'Total']], auctionTradeRows.map(v => [v.stockNumber, v.registrationNumber, `${v.make} ${v.model}`, formatDate(v.purchaseDate), purchaseTypeLabel(v.purchaseType), formatCurrency(v.purchasePrice), v.auctionCostNoVat != null ? formatCurrency(v.auctionCostNoVat) : "", v.auctionCostWithVat != null ? formatCurrency(v.auctionCostWithVat) : "", formatCurrency(auctionRowTotal(v))]));
              } else if (activeTab === 'sales' && salesReport) {
                exportPDF("Sales Report", [['Stock No', 'Reg', 'Sale Date', 'Sale Price (Net)', 'Sale VAT', 'Margin', 'VAT Due', 'Extras', 'Extras VAT']], salesRows.map(v => [v.stockNumber, v.registrationNumber, formatDate(v.saleDate), v.salePrice?.toString(), v.vatQualifying ? (v.saleVat ?? 0).toFixed(2) : '-', v.margin?.toString(), v.vatDue?.toString(), v.extrasNet.toFixed(2), v.extrasVat.toFixed(2)]));
              } else if (activeTab === 'finance' && financeRows.length) {
                exportPDF("Finance Report", [['Stock No', 'Reg', 'Make/Model', 'Sold', 'Buyer', 'Finance Company', 'Sale Price']], financeRows.map(v => [v.stockNumber, v.registrationNumber, `${v.make} ${v.model}`, formatDate(v.saleDate), v.buyerName, v.financeCompanyName ?? '', formatCurrency(v.salePrice)]));
              } else if (activeTab === 'deposits' && depositsReport) {
                exportPDF("Deposits Report", [['Date', 'Type', 'Stock No', 'Reg', 'Make/Model', 'Buyer', 'Amount']], depositsReport.map(d => [formatDate(d.date), d.type === 'received' ? 'Received' : 'Refunded', d.stockNumber, d.registrationNumber, `${d.make} ${d.model}`, d.buyerName ?? '', d.amount.toString()]));
              } else if (activeTab === 'outstanding' && outstandingRows.length) {
                exportPDF("Outstanding Amounts Report", [['Stock No', 'Reg', 'Make/Model', 'Sold', 'Customer', 'Total Invoiced', 'Total Paid', 'Outstanding']], outstandingRows.map(r => [r.stockNumber, r.registrationNumber, `${r.make} ${r.model}`, formatDate(r.saleDate), r.customerName, formatCurrency(r.totalInvoiced), formatCurrency(r.totalPaid), formatCurrency(r.outstanding)]));
              }
            }}>
              <FileText className="h-4 w-4 mr-2" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              if (activeTab === 'stock' && stockReport) exportExcel("Stock Report", stockReport);
              if (activeTab === 'purchases' && purchasesReport) exportExcel("Purchases Report", filteredPurchases.map(v => ({ ...v, purchaseType: purchaseTypeLabel(v.purchaseType), purchasePrice: v.totalPurchaseCost })));
              if (activeTab === 'auction' && auctionTradeRows.length) exportExcel("Auction & Trade Report", auctionTradeRows.map(v => ({ stockNumber: v.stockNumber, registrationNumber: v.registrationNumber, makeModel: `${v.make} ${v.model}`, purchased: v.purchaseDate, type: purchaseTypeLabel(v.purchaseType), purchasePrice: v.purchasePrice, costsNoVat: v.auctionCostNoVat ?? "", costsIncVat: v.auctionCostWithVat ?? "", total: auctionRowTotal(v) })));
              if (activeTab === 'sales' && salesReport) exportExcel("Sales Report", salesRows);
              if (activeTab === 'finance' && financeRows.length) exportExcel("Finance Report", financeRows.map(v => ({ stockNumber: v.stockNumber, registrationNumber: v.registrationNumber, makeModel: `${v.make} ${v.model}`, sold: v.saleDate ?? "", buyer: v.buyerName, financeCompany: v.financeCompanyName ?? "", salePrice: v.salePrice ?? 0 })));
              if (activeTab === 'deposits' && depositsReport) exportExcel("Deposits Report", depositsReport.map(d => ({ date: d.date, type: d.type, stockNumber: d.stockNumber, registrationNumber: d.registrationNumber, makeModel: `${d.make} ${d.model}`, buyer: d.buyerName ?? "", amount: d.amount })));
              if (activeTab === 'outstanding' && outstandingRows.length) exportExcel("Outstanding Amounts Report", outstandingRows.map(r => ({ stockNumber: r.stockNumber, registrationNumber: r.registrationNumber, makeModel: `${r.make} ${r.model}`, sold: r.saleDate ?? "", customer: r.customerName, totalInvoiced: r.totalInvoiced, totalPaid: r.totalPaid, outstanding: r.outstanding })));
            }}>
              <FileDown className="h-4 w-4 mr-2" /> Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stock No.</TableHead>
                  <TableHead>Reg</TableHead>
                  <TableHead>Make/Model</TableHead>
                  {(activeTab === "stock" || activeTab === "purchases") && <TableHead>Purchased</TableHead>}
                  {activeTab === "stock" && <TableHead className="text-right">Cost</TableHead>}
                  {activeTab === "purchases" && <TableHead className="text-right">Purchase Price</TableHead>}
                  {activeTab === "purchases" && <TableHead>Type</TableHead>}
                  {activeTab === "sales" && <TableHead>Sold</TableHead>}
                  {activeTab === "sales" && <TableHead className="text-right">Sale Price (Net)</TableHead>}
                  {activeTab === "sales" && <TableHead className="text-right">Sale VAT</TableHead>}
                  {activeTab === "sales" && <TableHead className="text-right">Margin</TableHead>}
                  {activeTab === "sales" && <TableHead className="text-right text-red-600">VAT Due</TableHead>}
                  {activeTab === "sales" && <TableHead className="text-right">Extras</TableHead>}
                  {activeTab === "sales" && <TableHead className="text-right">Extras VAT</TableHead>}
                  {activeTab === "finance" && <TableHead>Sold</TableHead>}
                  {activeTab === "finance" && <TableHead>Buyer</TableHead>}
                  {activeTab === "finance" && <TableHead>Finance Company</TableHead>}
                  {activeTab === "finance" && <TableHead className="text-right">Sale Price</TableHead>}
                  {activeTab === "outstanding" && <TableHead>Sold</TableHead>}
                  {activeTab === "outstanding" && <TableHead>Customer</TableHead>}
                  {activeTab === "outstanding" && <TableHead className="text-right">Total Invoiced</TableHead>}
                  {activeTab === "outstanding" && <TableHead className="text-right">Total Paid</TableHead>}
                  {activeTab === "outstanding" && <TableHead className="text-right text-red-600">Outstanding</TableHead>}
                  {activeTab === "deposits" && <TableHead>Date</TableHead>}
                  {activeTab === "deposits" && <TableHead>Type</TableHead>}
                  {activeTab === "deposits" && <TableHead>Buyer</TableHead>}
                  {activeTab === "deposits" && <TableHead className="text-right">Amount</TableHead>}
                  {activeTab === "auction" && <TableHead>Purchased</TableHead>}
                  {activeTab === "auction" && <TableHead>Type</TableHead>}
                  {activeTab === "auction" && <TableHead className="text-right">Purchase Price</TableHead>}
                  {activeTab === "auction" && <TableHead className="text-right">Costs (No VAT)</TableHead>}
                  {activeTab === "auction" && <TableHead className="text-right">Costs (inc VAT)</TableHead>}
                  {activeTab === "auction" && <TableHead className="text-right">Total</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeTab === "stock" && loadingStock && <TableRow><TableCell colSpan={6} className="text-center py-4">Loading...</TableCell></TableRow>}
                {activeTab === "stock" && stockReport?.map(v => (
                  <TableRow key={v.id}>
                    <TableCell><Link href={`/vehicles/${v.id}`} className="hover:underline font-medium" style={{ color: "var(--ac-text)" }}><StockNumber value={v.stockNumber} /></Link></TableCell>
                    <TableCell>{v.registrationNumber}</TableCell>
                    <TableCell><div>{v.make}</div><div className="text-slate-500">{v.model}</div></TableCell>
                    <TableCell>{formatDate(v.purchaseDate)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(v.totalPurchaseCost)}</TableCell>
                  </TableRow>
                ))}
                {activeTab === "stock" && stockReport && stockReport.length > 0 && (
                  <TableRow className="border-t-2 font-medium">
                    <TableCell colSpan={4} className="text-right text-slate-500">Total</TableCell>
                    <TableCell className="text-right">{formatCurrency(stockReport.reduce((s, v) => s + (v.totalPurchaseCost || 0), 0))}</TableCell>
                  </TableRow>
                )}

                {activeTab === "purchases" && loadingPurchases && <TableRow><TableCell colSpan={6} className="text-center py-4">Loading...</TableCell></TableRow>}
                {activeTab === "purchases" && filteredPurchases.map(v => (
                  <TableRow key={v.id}>
                    <TableCell><Link href={`/vehicles/${v.id}`} className="hover:underline font-medium" style={{ color: "var(--ac-text)" }}><StockNumber value={v.stockNumber} /></Link></TableCell>
                    <TableCell>{v.registrationNumber}</TableCell>
                    <TableCell><div>{v.make}</div><div className="text-slate-500">{v.model}</div></TableCell>
                    <TableCell>{formatDate(v.purchaseDate)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(v.totalPurchaseCost)}</TableCell>
                    <TableCell>{purchaseTypeLabel(v.purchaseType)}</TableCell>
                  </TableRow>
                ))}
                {activeTab === "purchases" && !loadingPurchases && filteredPurchases.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-4 text-slate-500">No purchases match the selected filters.</TableCell></TableRow>
                )}
                {activeTab === "purchases" && filteredPurchases.length > 0 && (
                  <TableRow className="border-t-2 font-medium">
                    <TableCell colSpan={4} className="text-right text-slate-500">Total</TableCell>
                    <TableCell className="text-right">{formatCurrency(filteredPurchases.reduce((s, v) => s + (v.totalPurchaseCost || 0), 0))}</TableCell>
                    <TableCell />
                  </TableRow>
                )}

                {activeTab === "sales" && loadingSales && <TableRow><TableCell colSpan={10} className="text-center py-4">Loading...</TableCell></TableRow>}
                {activeTab === "sales" && salesRows.map(v => (
                  <TableRow key={v.id}>
                    <TableCell><Link href={`/vehicles/${v.id}`} className="hover:underline font-medium" style={{ color: "var(--ac-text)" }}><StockNumber value={v.stockNumber} /></Link></TableCell>
                    <TableCell>{v.registrationNumber}</TableCell>
                    <TableCell><div>{v.make}</div><div className="text-slate-500">{v.model}</div></TableCell>
                    <TableCell>{formatDate(v.saleDate)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(v.salePrice)}</TableCell>
                    <TableCell className="text-right">{v.vatQualifying ? formatCurrency(v.saleVat ?? 0) : "-"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(v.margin)}</TableCell>
                    <TableCell className="text-right font-bold text-red-600">{formatCurrency(v.vatDue)}</TableCell>
                    <TableCell className="text-right">{v.extrasNet ? formatCurrency(v.extrasNet) : "-"}</TableCell>
                    <TableCell className="text-right">{v.extrasVat ? formatCurrency(v.extrasVat) : "-"}</TableCell>
                  </TableRow>
                ))}
                {activeTab === "sales" && salesRows.length > 0 && (
                  <TableRow className="border-t-2 font-medium">
                    <TableCell colSpan={4} className="text-right text-slate-500">Total</TableCell>
                    <TableCell className="text-right">{formatCurrency(salesRows.reduce((s, v) => s + (v.salePrice || 0), 0))}</TableCell>
                    <TableCell className="text-right">{formatCurrency(salesRows.reduce((s, v) => s + (v.vatQualifying ? (v.saleVat ?? 0) : 0), 0))}</TableCell>
                    <TableCell className="text-right">{formatCurrency(salesRows.reduce((s, v) => s + (v.margin || 0), 0))}</TableCell>
                    <TableCell className="text-right font-bold text-red-600">{formatCurrency(salesRows.reduce((s, v) => s + (v.vatDue || 0), 0))}</TableCell>
                    <TableCell className="text-right">{formatCurrency(salesRows.reduce((s, v) => s + v.extrasNet, 0))}</TableCell>
                    <TableCell className="text-right">{formatCurrency(salesRows.reduce((s, v) => s + v.extrasVat, 0))}</TableCell>
                  </TableRow>
                )}

                {activeTab === "finance" && (loadingSales || loadingInvoices) && <TableRow><TableCell colSpan={7} className="text-center py-4">Loading...</TableCell></TableRow>}
                {activeTab === "finance" && !loadingSales && !loadingInvoices && financeRows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-4 text-slate-500">No cars sold on finance in this period.</TableCell></TableRow>}
                {activeTab === "finance" && financeRows.map(v => (
                  <TableRow key={v.id}>
                    <TableCell><Link href={`/vehicles/${v.id}`} className="hover:underline font-medium" style={{ color: "var(--ac-text)" }}><StockNumber value={v.stockNumber} /></Link></TableCell>
                    <TableCell>{v.registrationNumber}</TableCell>
                    <TableCell><div>{v.make}</div><div className="text-slate-500">{v.model}</div></TableCell>
                    <TableCell>{formatDate(v.saleDate)}</TableCell>
                    <TableCell>{v.buyerName || "—"}</TableCell>
                    <TableCell>{v.financeCompanyName}</TableCell>
                    <TableCell className="text-right">{formatCurrency(v.salePrice)}</TableCell>
                  </TableRow>
                ))}
                {activeTab === "finance" && financeRows.length > 0 && (
                  <TableRow className="border-t-2 font-medium">
                    <TableCell colSpan={6} className="text-right text-slate-500">Total</TableCell>
                    <TableCell className="text-right">{formatCurrency(financeRows.reduce((s, v) => s + (v.salePrice || 0), 0))}</TableCell>
                  </TableRow>
                )}

                {activeTab === "outstanding" && loadingOutstanding && <TableRow><TableCell colSpan={8} className="text-center py-4">Loading...</TableCell></TableRow>}
                {activeTab === "outstanding" && !loadingOutstanding && outstandingRows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-4 text-slate-500">No outstanding balances. All recorded sales are fully paid.</TableCell></TableRow>}
                {activeTab === "outstanding" && outstandingRows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell><Link href={`/vehicles/${r.id}`} className="hover:underline font-medium" style={{ color: "var(--ac-text)" }}><StockNumber value={r.stockNumber} /></Link></TableCell>
                    <TableCell>{r.registrationNumber}</TableCell>
                    <TableCell><div>{r.make}</div><div className="text-slate-500">{r.model}</div></TableCell>
                    <TableCell>{formatDate(r.saleDate)}</TableCell>
                    <TableCell>{r.customerName || "—"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.totalInvoiced)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.totalPaid)}</TableCell>
                    <TableCell className="text-right font-bold text-red-600">{formatCurrency(r.outstanding)}</TableCell>
                  </TableRow>
                ))}
                {activeTab === "outstanding" && outstandingRows.length > 0 && (
                  <TableRow className="border-t-2 font-medium">
                    <TableCell colSpan={4}></TableCell>
                    <TableCell className="text-right text-slate-500">Total</TableCell>
                    <TableCell className="text-right">{formatCurrency(outstandingInvoicedTotal)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(outstandingPaidTotal)}</TableCell>
                    <TableCell className="text-right font-bold text-red-600">{formatCurrency(outstandingTotal)}</TableCell>
                  </TableRow>
                )}

                {activeTab === "deposits" && loadingDeposits && <TableRow><TableCell colSpan={7} className="text-center py-4">Loading...</TableCell></TableRow>}
                {activeTab === "deposits" && depositsReport?.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-4 text-slate-500">No deposits received or refunded in this period.</TableCell></TableRow>}
                {activeTab === "deposits" && depositsReport?.map(d => (
                  <TableRow key={d.id}>
                    <TableCell><Link href={`/vehicles/${d.vehicleId}`} className="hover:underline font-medium" style={{ color: "var(--ac-text)" }}><StockNumber value={d.stockNumber} /></Link></TableCell>
                    <TableCell>{d.registrationNumber}</TableCell>
                    <TableCell><div>{d.make}</div><div className="text-slate-500">{d.model}</div></TableCell>
                    <TableCell>{formatDate(d.date)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${d.type === "received" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {d.type === "received" ? "Received" : "Refunded"}
                      </span>
                    </TableCell>
                    <TableCell>{d.buyerName ?? "—"}</TableCell>
                    <TableCell className={`text-right font-medium ${d.type === "refunded" ? "text-red-600" : ""}`}>{d.type === "refunded" ? `(${formatCurrency(d.amount)})` : formatCurrency(d.amount)}</TableCell>
                  </TableRow>
                ))}
                {activeTab === "deposits" && depositsReport && depositsReport.length > 0 && (
                  <TableRow className="border-t-2 font-medium">
                    <TableCell colSpan={6} className="text-right text-slate-500">Net Total</TableCell>
                    <TableCell className="text-right">{formatCurrency(depositsReport.reduce((s, d) => s + (d.type === "refunded" ? -(d.amount || 0) : (d.amount || 0)), 0))}</TableCell>
                  </TableRow>
                )}

                {activeTab === "auction" && loadingPurchases && <TableRow><TableCell colSpan={9} className="text-center py-4">Loading...</TableCell></TableRow>}
                {activeTab === "auction" && !loadingPurchases && auctionTradeRows.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center py-4 text-slate-500">No auction or trade purchases match the selected filters.</TableCell></TableRow>
                )}
                {activeTab === "auction" && auctionTradeRows.map(v => (
                  <TableRow key={v.id}>
                    <TableCell><Link href={`/vehicles/${v.id}`} className="hover:underline font-medium" style={{ color: "var(--ac-text)" }}><StockNumber value={v.stockNumber} /></Link></TableCell>
                    <TableCell>{v.registrationNumber}</TableCell>
                    <TableCell><div>{v.make}</div><div className="text-slate-500">{v.model}</div></TableCell>
                    <TableCell>{formatDate(v.purchaseDate)}</TableCell>
                    <TableCell>{purchaseTypeLabel(v.purchaseType)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(v.purchasePrice)}</TableCell>
                    <TableCell className="text-right">{v.auctionCostNoVat != null ? formatCurrency(v.auctionCostNoVat) : "—"}</TableCell>
                    <TableCell className="text-right">{v.auctionCostWithVat != null ? formatCurrency(v.auctionCostWithVat) : "—"}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(auctionRowTotal(v))}</TableCell>
                  </TableRow>
                ))}
                {activeTab === "auction" && auctionTradeRows.length > 0 && (
                  <TableRow className="border-t-2 font-medium">
                    <TableCell colSpan={5} className="text-right text-slate-500">Total</TableCell>
                    <TableCell className="text-right">{formatCurrency(auctionTradeRows.reduce((s, v) => s + (v.purchasePrice || 0), 0))}</TableCell>
                    <TableCell className="text-right">{formatCurrency(auctionTradeRows.reduce((s, v) => s + (v.auctionCostNoVat ?? 0), 0))}</TableCell>
                    <TableCell className="text-right">{formatCurrency(auctionTradeRows.reduce((s, v) => s + (v.auctionCostWithVat ?? 0), 0))}</TableCell>
                    <TableCell className="text-right">{formatCurrency(auctionTradeRows.reduce((s, v) => s + auctionRowTotal(v), 0))}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      )}
      </>
      )}
    </div>
  );
}