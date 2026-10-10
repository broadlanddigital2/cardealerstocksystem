import { useState } from "react";
import {
  useListVehicles,
  useListCashExpenses,
  useCreateCashExpense,
  useDeleteCashExpense,
  getListCashExpensesQueryKey,
  useGetSettings,
  useUpdateSettings,
  getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Banknote,
  Check,
  FileDown,
  FileText,
  Loader2,
  Pencil,
  PlusCircle,
  Trash2,
  X,
} from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";
import Papa from "papaparse";

const CASH = "Cash";

const toISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

type Period = { label: string; from: string; to: string };

const buildPeriods = (today: Date): Period[] => {
  const y = today.getFullYear();
  const m = today.getMonth();

  const thisMonthFrom = new Date(y, m, 1);
  const thisMonthTo = new Date(y, m + 1, 0);

  const lastMonthFrom = new Date(y, m - 1, 1);
  const lastMonthTo = new Date(y, m, 0);

  const quarterStartMonth = Math.floor(m / 3) * 3;
  const thisQuarterFrom = new Date(y, quarterStartMonth, 1);
  const thisQuarterTo = new Date(y, quarterStartMonth + 3, 0);

  // UK financial year runs 6 April – 5 April. If today is on/after 6 April,
  // the year starts this calendar year, otherwise it started last year.
  const afterApril6 =
    m > 3 || (m === 3 && today.getDate() >= 6);
  const fyStartYear = afterApril6 ? y : y - 1;
  const financialYearFrom = new Date(fyStartYear, 3, 6);
  const financialYearTo = new Date(fyStartYear + 1, 3, 5);

  return [
    { label: "This month", from: toISO(thisMonthFrom), to: toISO(thisMonthTo) },
    { label: "Last month", from: toISO(lastMonthFrom), to: toISO(lastMonthTo) },
    {
      label: "This quarter",
      from: toISO(thisQuarterFrom),
      to: toISO(thisQuarterTo),
    },
    {
      label: "This financial year",
      from: toISO(financialYearFrom),
      to: toISO(financialYearTo),
    },
  ];
};

type LedgerEntry = {
  key: string;
  date: string;
  description: string;
  moneyIn: number;
  moneyOut: number;
  expenseId?: number;
};

export default function CashSheet() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: vehicles, isLoading: loadingVehicles } = useListVehicles();
  const { data: expenses, isLoading: loadingExpenses } = useListCashExpenses();
  const { data: settings } = useGetSettings();

  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [asAtDate, setAsAtDate] = useState("");
  const [editingOpening, setEditingOpening] = useState(false);
  const [openingInput, setOpeningInput] = useState("");

  const periods = buildPeriods(new Date());
  const activePeriod = periods.find(
    (p) => p.from === fromDate && p.to === toDate,
  );

  const applyPeriod = (p: Period) => {
    setFromDate(p.from);
    setToDate(p.to);
  };

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListCashExpensesQueryKey() });

  const createExpense = useCreateCashExpense({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDescription("");
        setAmount("");
        toast({ title: "Cash expense added" });
      },
      onError: () =>
        toast({
          title: "Could not add expense",
          description: "Please check the details and try again.",
          variant: "destructive",
        }),
    },
  });

  const deleteExpense = useDeleteCashExpense({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDeleteId(null);
        toast({ title: "Cash expense deleted" });
      },
      onError: () =>
        toast({
          title: "Could not delete expense",
          variant: "destructive",
        }),
    },
  });

  const updateSettings = useUpdateSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        setEditingOpening(false);
        toast({ title: "Opening balance saved" });
      },
      onError: () =>
        toast({
          title: "Could not save opening balance",
          variant: "destructive",
        }),
    },
  });

  // Persisted starting cash float: cash on hand before any recorded movements.
  const baseOpeningBalance = settings?.cashOpeningBalance ?? 0;

  const startEditOpening = () => {
    setOpeningInput(baseOpeningBalance ? String(baseOpeningBalance) : "");
    setEditingOpening(true);
  };

  const saveOpening = () => {
    const value = openingInput.trim() === "" ? 0 : parseFloat(openingInput);
    if (isNaN(value)) {
      toast({
        title: "Invalid amount",
        description: "Enter a number for the opening balance.",
        variant: "destructive",
      });
      return;
    }
    updateSettings.mutate({ data: { cashOpeningBalance: value } });
  };

  // Cash movements derived from vehicle records: holding deposits taken in
  // cash and any payment-schedule entries recorded with the Cash method.
  // "Payment to Customer" cash entries are money out (cash refunded).
  const vehicleEntries: LedgerEntry[] = (vehicles ?? []).flatMap((v) => {
    const label = `${v.make} ${v.model} (${v.registrationNumber})`;
    const entries: LedgerEntry[] = [];
    if (
      v.holdingDepositPaymentMethod === CASH &&
      v.holdingDepositAmount != null &&
      v.holdingDepositAmount > 0
    ) {
      entries.push({
        key: `dep-${v.id}`,
        date: v.holdingDepositDate ?? v.saleDate ?? "",
        description: `Holding deposit — ${label}`,
        moneyIn: v.holdingDepositAmount,
        moneyOut: 0,
      });
    }
    (v.payments ?? []).forEach((p, i) => {
      if (p.paymentMethod !== CASH) return;
      const amt = Number(p.amount) || 0;
      if (amt === 0) return;
      const isRefund = p.type === "Payment to Customer";
      entries.push({
        key: `pay-${v.id}-${i}`,
        date: p.date || v.saleDate || "",
        description: `${p.type || "Payment"} — ${label}`,
        moneyIn: isRefund ? 0 : amt,
        moneyOut: isRefund ? amt : 0,
      });
    });
    return entries;
  });

  const expenseEntries: LedgerEntry[] = (expenses ?? []).map((e) => ({
    key: `exp-${e.id}`,
    date: e.date,
    description: e.description,
    moneyIn: 0,
    moneyOut: e.amount,
    expenseId: e.id,
  }));

  const ledger = [...vehicleEntries, ...expenseEntries].sort((a, b) => {
    if (a.date === b.date) return a.key.localeCompare(b.key);
    return a.date < b.date ? -1 : 1;
  });

  // The upper cut-off is the earliest (most restrictive) of the To date and
  // the "As at" date, so a balance-as-at-date is honoured even alongside a
  // period filter. ISO date strings sort chronologically.
  const upperBounds = [toDate, asAtDate].filter(Boolean) as string[];
  const effectiveTo = upperBounds.length
    ? upperBounds.reduce((earliest, d) => (d < earliest ? d : earliest))
    : "";

  // Opening balance = the persisted starting cash float plus the net of all
  // movements that fall strictly before the selected From date. With no From
  // date there is no prior period, so it's just the starting float.
  const openingBalance = fromDate
    ? baseOpeningBalance +
      ledger
        .filter((e) => e.date && e.date < fromDate)
        .reduce((s, e) => s + e.moneyIn - e.moneyOut, 0)
    : baseOpeningBalance;

  const filteredLedger = ledger.filter((e) => {
    if (fromDate && (!e.date || e.date < fromDate)) return false;
    if (effectiveTo && (!e.date || e.date > effectiveTo)) return false;
    return true;
  });

  // Running balance within the filtered view carries on from the opening balance.
  let running = openingBalance;
  const ledgerWithBalance = filteredLedger.map((e) => {
    running += e.moneyIn - e.moneyOut;
    return { ...e, balance: running };
  });

  const totalIn = filteredLedger.reduce((s, e) => s + e.moneyIn, 0);
  const totalOut = filteredLedger.reduce((s, e) => s + e.moneyOut, 0);
  const closingBalance = openingBalance + totalIn - totalOut;
  const hasDateFilter = Boolean(fromDate || toDate || asAtDate);
  const closingBalanceLabel = asAtDate
    ? `Balance as at ${formatDate(asAtDate)}`
    : "Closing Balance";

  const isLoading = loadingVehicles || loadingExpenses;

  // Export rows: Date, Description, Money In, Money Out, Balance. Money columns
  // are left blank when zero to mirror the on-screen ledger.
  const money = (n: number) => (n > 0 ? n.toFixed(2) : "");
  const exportRows = ledgerWithBalance.map((e) => ({
    Date: formatDate(e.date),
    Description: e.description,
    "Money In": money(e.moneyIn),
    "Money Out": money(e.moneyOut),
    Balance: e.balance.toFixed(2),
  }));

  const totalsRow = {
    Date: "",
    Description: "Totals",
    "Money In": totalIn.toFixed(2),
    "Money Out": totalOut.toFixed(2),
    Balance: closingBalance.toFixed(2),
  };

  const exportCsv = () => {
    const csv = Papa.unparse([...exportRows, totalsRow]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Cash_Sheet.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Cash Sheet");
    ws.columns = [
      { header: "Date", key: "Date" },
      { header: "Description", key: "Description" },
      { header: "Money In", key: "Money In" },
      { header: "Money Out", key: "Money Out" },
      { header: "Balance", key: "Balance" },
    ];
    [...exportRows, totalsRow].forEach((row) => ws.addRow(row));
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Cash_Sheet.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const doc = new jsPDF();
    doc.text("Cash Sheet", 14, 15);
    if (asAtDate) {
      doc.setFontSize(10);
      doc.text(`Balance as at ${formatDate(asAtDate)}`, 14, 21);
      doc.setFontSize(16);
    }
    autoTable(doc, {
      startY: 25,
      head: [["Date", "Description", "Money In", "Money Out", "Balance"]],
      body: ledgerWithBalance.map((e) => [
        formatDate(e.date),
        e.description,
        e.moneyIn > 0 ? formatCurrency(e.moneyIn) : "",
        e.moneyOut > 0 ? formatCurrency(e.moneyOut) : "",
        formatCurrency(e.balance),
      ]),
      foot: [
        [
          "",
          "Totals",
          formatCurrency(totalIn),
          formatCurrency(totalOut),
          formatCurrency(closingBalance),
        ],
      ],
      theme: "striped",
    });
    doc.save("Cash_Sheet.pdf");
  };

  const handleAdd = (ev: React.FormEvent) => {
    ev.preventDefault();
    const numericAmount = parseFloat(amount);
    if (!date || !description.trim() || isNaN(numericAmount) || numericAmount <= 0) {
      toast({
        title: "Missing details",
        description: "Enter a date, description and a positive amount.",
        variant: "destructive",
      });
      return;
    }
    createExpense.mutate({
      data: { date, description: description.trim(), amount: numericAmount },
    });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Banknote className="h-7 w-7 text-[#5f9128]" />
        <h1 className="text-2xl font-bold text-slate-900">Cash Sheet</h1>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base">Filter by date</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {periods.map((p) => (
              <Button
                key={p.label}
                type="button"
                size="sm"
                variant={activePeriod?.label === p.label ? "default" : "outline"}
                onClick={() => applyPeriod(p)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="cs-from">From</Label>
              <Input
                id="cs-from"
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-auto"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cs-to">To</Label>
              <Input
                id="cs-to"
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                className="w-auto"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cs-asat">Balance as at</Label>
              <Input
                id="cs-asat"
                type="date"
                value={asAtDate}
                min={fromDate || undefined}
                onChange={(e) => setAsAtDate(e.target.value)}
                className="w-auto"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!hasDateFilter}
              onClick={() => {
                setFromDate("");
                setToDate("");
                setAsAtDate("");
              }}
            >
              Clear
            </Button>
            {hasDateFilter && (
              <p className="text-sm text-slate-500 sm:ml-auto">
                {asAtDate
                  ? `Cash balance as at ${formatDate(asAtDate)}`
                  : `Showing ${
                      fromDate ? formatDate(fromDate) : "the start"
                    } to ${toDate ? formatDate(toDate) : "today"}`}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base">Add cash expense</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleAdd} className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="ce-date">Date</Label>
                <Input
                  id="ce-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-auto"
                />
              </div>
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="ce-desc">Description</Label>
                <Input
                  id="ce-desc"
                  placeholder="e.g. Valeting, fuel, parts"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ce-amount">Amount (£)</Label>
                <Input
                  id="ce-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-36"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={createExpense.isPending}>
                {createExpense.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <PlusCircle className="h-4 w-4 mr-2" />
                )}
                Add Expense
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
          <CardTitle>Cash Ledger</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={ledgerWithBalance.length === 0}
            >
              <FileDown className="h-4 w-4 mr-2" /> CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportExcel}
              disabled={ledgerWithBalance.length === 0}
            >
              <FileDown className="h-4 w-4 mr-2" /> Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportPdf}
              disabled={ledgerWithBalance.length === 0}
            >
              <FileText className="h-4 w-4 mr-2" /> PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Money In</TableHead>
                  <TableHead className="text-right">Money Out</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6">
                      Loading...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && ledgerWithBalance.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-6 text-slate-500"
                    >
                      {hasDateFilter
                        ? "No cash transactions in the selected date range."
                        : "No cash transactions yet. Cash payments and deposits appear here automatically, and you can add cash expenses above."}
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  hasDateFilter &&
                  ledgerWithBalance.length > 0 && (
                    <TableRow className="bg-slate-50 text-slate-500">
                      <TableCell colSpan={4} className="font-medium">
                        Opening balance
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(openingBalance)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                {!isLoading &&
                  ledgerWithBalance.map((e) => (
                    <TableRow key={e.key}>
                      <TableCell>{formatDate(e.date)}</TableCell>
                      <TableCell>{e.description}</TableCell>
                      <TableCell className="text-right text-[#5f9128]">
                        {e.moneyIn > 0 ? formatCurrency(e.moneyIn) : ""}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {e.moneyOut > 0 ? formatCurrency(e.moneyOut) : ""}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(e.balance)}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.expenseId != null && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-400 hover:text-red-600"
                            onClick={() => setDeleteId(e.expenseId!)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                {!isLoading && ledgerWithBalance.length > 0 && (
                  <TableRow className="border-t-2 font-medium">
                    <TableCell colSpan={2} className="text-right text-slate-500">
                      {hasDateFilter ? "Period totals" : "Totals"}
                    </TableCell>
                    <TableCell className="text-right text-[#5f9128]">
                      {formatCurrency(totalIn)}
                    </TableCell>
                    <TableCell className="text-right text-red-600">
                      {formatCurrency(totalOut)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(closingBalance)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 flex items-center justify-between">
              Opening Balance
              {!editingOpening && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-slate-400 hover:text-slate-700"
                  onClick={startEditOpening}
                  title="Edit starting cash float"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {editingOpening ? (
              <div className="space-y-2">
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={openingInput}
                  onChange={(e) => setOpeningInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveOpening();
                    if (e.key === "Escape") setEditingOpening(false);
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={saveOpening}
                    disabled={updateSettings.isPending}
                  >
                    {updateSettings.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingOpening(false)}
                    disabled={updateSettings.isPending}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p
                  className={`text-2xl font-bold ${
                    openingBalance < 0 ? "text-red-600" : "text-slate-900"
                  }`}
                >
                  {formatCurrency(openingBalance)}
                </p>
                {baseOpeningBalance !== 0 && (
                  <p className="text-xs text-slate-400 mt-1">
                    Starting float {formatCurrency(baseOpeningBalance)}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              {hasDateFilter ? "Money In (period)" : "Cash Received"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-slate-900">
              {formatCurrency(totalIn)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              {hasDateFilter ? "Money Out (period)" : "Cash Out"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-slate-900">
              {formatCurrency(totalOut)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              {closingBalanceLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-bold ${
                closingBalance < 0 ? "text-red-600" : "text-slate-900"
              }`}
            >
              {formatCurrency(closingBalance)}
            </p>
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={deleteId != null}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete cash expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the expense and adjust your cash balance. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() =>
                deleteId != null && deleteExpense.mutate({ id: deleteId })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
