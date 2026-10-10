import { useState, useEffect } from "react";
import { useLocation } from "@/lib/router";
import { useAuth } from "@clerk/nextjs";
import { 
  useGetVehicle, 
  getGetVehicleQueryKey,
  getListVehiclesQueryKey,
  getGetDashboardSummaryQueryKey,
  useDeleteVehicle,
  useUpdateVehicle,
  useRecordSale,
  useRecordHoldingDeposit,
  useRefundHoldingDeposit,
  useCreateVehicleInvoice,
  useGetVehicleInvoice,
  useGetSettings,
  useListSellers,
  useListFinanceCompanies,
  getNextInvoiceNumber,
  getListInvoicesQueryKey,
  getGetVehicleInvoiceQueryKey,
  getGetStockReportQueryKey,
  getGetSalesReportQueryKey,
  getGetPurchasesReportQueryKey,
  getGetDepositsReportQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatDate } from "@/lib/format";
import { deriveFinancePayment } from "@/lib/financePayment";
import { useToast } from "@/hooks/use-toast";
import { generateInvoicePdf, generateVatVehicleInvoicePdf, generateExtrasInvoicePdf, generateHoldingDepositPdf } from "@/lib/invoicePdf";
import { computeInvoiceBalancePayable, selectFinanceInvoiceExtras, selectSeparateInvoiceExtras } from "@/lib/invoiceMath";
import { Checkbox } from "@/components/ui/checkbox";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Trash2, Edit, FileText, PoundSterling, Loader2, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VehiclePhotosUploader } from "@/components/VehiclePhotosUploader";
import { mapRegistrationLookupToPartExchange, normalizeRegistration, RegistrationLookup } from "@/components/RegistrationLookup";

type PaymentRow = { date: string; amount: string; paymentMethod: string; type: string };

const PAYMENT_METHODS = ["Bank Transfer", "Cash", "Debit/Credit Card", "Cheque", "Finance"];
const HOLDING_DEPOSIT_PAYMENT_METHODS = PAYMENT_METHODS.filter(m => m !== "Finance");
const PAYMENT_TYPES = ["Deposit", "Part Payment", "Full Payment", "Payment to Customer"];

function paymentTotal(rows: { amount?: number | string | null; type?: string | null }[]): number {
  return rows.reduce((sum, p) => {
    const amt = Number(p.amount) || 0;
    return p.type === "Payment to Customer" ? sum - amt : sum + amt;
  }, 0);
}

function resizePayments(rows: PaymentRow[], n: number): PaymentRow[] {
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const next = rows.slice(0, count);
  while (next.length < count) next.push({ date: "", amount: "", paymentMethod: "", type: "" });
  return next;
}

function PaymentSchedule({
  rows,
  onChange,
  onRemove,
  showLabel = true,
  showTotal = false,
}: {
  rows: PaymentRow[];
  onChange: (rows: PaymentRow[]) => void;
  onRemove?: (i: number) => void;
  showLabel?: boolean;
  showTotal?: boolean;
}) {
  if (rows.length === 0) return null;
  const total = paymentTotal(rows);
  const setRow = (i: number, patch: Partial<PaymentRow>) => {
    const next = [...rows];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  return (
    <div className="space-y-2 col-span-2">
      {showLabel && <Label>Payments</Label>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Payment Method</TableHead>
            <TableHead className="text-right">Amount (£)</TableHead>
            {onRemove && <TableHead className="w-10"></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p, i) => (
            <TableRow key={i}>
              <TableCell className="text-slate-500">{i + 1}</TableCell>
              <TableCell>
                <Input type="date" value={p.date} onChange={e => setRow(i, { date: e.target.value })} />
              </TableCell>
              <TableCell>
                <Select value={p.type} onValueChange={value => setRow(i, { type: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Select value={p.paymentMethod} onValueChange={value => setRow(i, { paymentMethod: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input type="number" step="0.01" min="0" className="text-right" value={p.amount} onChange={e => setRow(i, { amount: e.target.value })} />
              </TableCell>
              {onRemove && (
                <TableCell>
                  <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(i)} aria-label="Remove payment">
                    <Trash2 className="h-4 w-4 text-slate-500" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
          {showTotal && (
            <TableRow className="border-t-2 font-medium">
              <TableCell></TableCell>
              <TableCell className="text-slate-500">Total</TableCell>
              <TableCell></TableCell>
              <TableCell></TableCell>
              <TableCell className="text-right">{formatCurrency(total)}</TableCell>
              {onRemove && <TableCell></TableCell>}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export default function VehicleDetail({ id }: { id: string }) {
  const vehicleId = parseInt(id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const basePath = "";

  // Invalidate every view that derives from a vehicle's data so changes (even
  // to a sold vehicle's purchase details) propagate to the detail page, stock
  // book, dashboard, all reports, and exports.
  const invalidateVehicleData = () => {
    queryClient.invalidateQueries({ queryKey: getGetVehicleQueryKey(vehicleId) });
    queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetStockReportQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSalesReportQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPurchasesReportQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDepositsReportQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetVehicleInvoiceQueryKey(vehicleId) });
  };

  const { data: vehicle, isLoading } = useGetVehicle(vehicleId, {
    query: { enabled: !!vehicleId, queryKey: getGetVehicleQueryKey(vehicleId) }
  });
  const { data: settings } = useGetSettings();
  const { data: vehicleInvoice, refetch: refetchVehicleInvoice } = useGetVehicleInvoice(vehicleId, {
    query: {
      enabled: !!vehicleId && vehicle?.status === "sold",
      queryKey: getGetVehicleInvoiceQueryKey(vehicleId),
    },
  });
  const extrasTotal = (vehicleInvoice?.extras ?? []).reduce((s, ex) => s + ex.amount + (ex.vat ?? 0), 0);
  const vatRatePct = Number(settings?.vatRate ?? 0) || 0;
  const computeExtraVat = (amount: string | number, vatable: boolean): number => {
    if (!vatable) return 0;
    const amt = typeof amount === "number" ? amount : Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return 0;
    return Math.round(amt * vatRatePct) / 100;
  };
  const derivedFinancePayment = deriveFinancePayment({
    financeCompanyName: vehicleInvoice?.financeCompanyName,
    balancePayable: vehicleInvoice?.balancePayable,
    saleDate: vehicle?.saleDate,
  });
  // Drop any stored "Finance" row when we derive one, so legacy/manual finance
  // settlements never double-count against the derived balance payable.
  const manualPayments = (vehicle?.payments ?? []).filter(
    (p) => !(derivedFinancePayment && p.paymentMethod === "Finance"),
  );
  const scheduleRows = [
    ...(vehicle?.holdingDepositAmount != null && vehicle.holdingDepositAmount > 0
      ? [{ date: vehicle.holdingDepositDate ?? "", amount: vehicle.holdingDepositAmount, paymentMethod: vehicle.holdingDepositPaymentMethod ?? "", type: "Deposit" }]
      : []),
    ...(vehicle?.partExchangeAllowance != null && vehicle.partExchangeAllowance > 0
      ? [{ date: vehicle.saleDate ?? "", amount: vehicle.partExchangeAllowance, paymentMethod: "Part Exchange", type: "Part Exchange" }]
      : []),
    ...(derivedFinancePayment ? [derivedFinancePayment] : []),
    ...manualPayments,
  ];
  // Invoiced total must include sale VAT for VAT-qualifying vehicles so it stays
  // consistent with balancePayable (which includes VAT) when summing payments.
  const saleVatTotal =
    vehicle?.vatQualifying && vehicle?.saleVat != null ? Number(vehicle.saleVat) : 0;
  const invoicesTotal = (vehicle?.salePrice ?? 0) + saleVatTotal + extrasTotal;
  const outstandingAmount = invoicesTotal - paymentTotal(scheduleRows);

  const deleteVehicle = useDeleteVehicle();
  const updateVehicle = useUpdateVehicle();
  const recordSale = useRecordSale();
  const recordHoldingDeposit = useRecordHoldingDeposit();
  const refundHoldingDeposit = useRefundHoldingDeposit();
  const createInvoice = useCreateVehicleInvoice();
  const { data: sellers = [] } = useListSellers();
  const { data: financeCompanies = [] } = useListFinanceCompanies();

  const [isDeleting, setIsDeleting] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedSellerId, setSelectedSellerId] = useState<string>("new");
  const [editData, setEditData] = useState({
    registrationNumber: "",
    make: "",
    model: "",
    vin: "",
    colour: "",
    description: "",
    mileageAtPurchase: "",
    purchaseDate: "",
    purchasePrice: "",
    vatQualifying: false,
    purchaseVat: "",
    purchaseType: "trade",
    purchaseInvoiceNumber: "",
    auctionCostNoVat: "",
    auctionCostWithVat: "",
    sellerName: "",
    sellerAddress: "",
    purchaseNotes: "",
    askingPrice: "",
    marketingDescription: "",
    published: false,
    showroomSold: false,
    photoUrls: [] as Array<string>,
  });
  // When editing a VAT-qualifying vehicle, auto-calculate Purchase VAT from the
  // net purchase price using the dealer's configured VAT rate; clear it otherwise.
  useEffect(() => {
    if (!editDialogOpen) return;
    if (editData.vatQualifying && settings?.vatRate) {
      const rate = Number(settings.vatRate);
      const net = Number(editData.purchasePrice) || 0;
      if (!Number.isNaN(rate)) {
        const vat = String(Math.round(net * (rate / 100) * 100) / 100);
        setEditData((prev) => (prev.purchaseVat === vat ? prev : { ...prev, purchaseVat: vat }));
      }
    } else if (!editData.vatQualifying) {
      setEditData((prev) => (prev.purchaseVat === "" ? prev : { ...prev, purchaseVat: "" }));
    }
  }, [editDialogOpen, editData.vatQualifying, editData.purchasePrice, settings?.vatRate]);

  const [saleDialogOpen, setSaleDialogOpen] = useState(false);
  // After a sale, if the vehicle is on the public website, ask the dealer when
  // it should be removed from the site.
  const [removalDialogOpen, setRemovalDialogOpen] = useState(false);
  const [removalSubmitting, setRemovalSubmitting] = useState(false);
  const [isFinanceSale, setIsFinanceSale] = useState(false);
  const [saleData, setSaleData] = useState({
    saleDate: new Date().toISOString().split('T')[0],
    salesInvoiceNumber: "",
    buyerName: "",
    buyerAddress: "",
    buyerEmail: "",
    buyerPhone: "",
    salePrice: "",
    saleVat: "",
    paymentMethod: "",
    partExchangeAllowance: "",
    partExchangeMake: "",
    partExchangeModel: "",
    partExchangeRegistration: "",
    partExchangeMileage: "",
    saleNotes: "",
    invoiceNotes: "",
    financeCompanyName: "",
    financeCompanyAddress: "",
    financeCompanyEmail: ""
  });
  const [selectedFinanceCompanyId, setSelectedFinanceCompanyId] = useState<string>("manual");
  const [saleExtras, setSaleExtras] = useState<{ description: string; amount: string; vatable: boolean; onFinanceInvoice: boolean }[]>([]);
  const [isSelling, setIsSelling] = useState(false);
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [depositData, setDepositData] = useState({
    holdingDepositAmount: "",
    holdingDepositDate: new Date().toISOString().split("T")[0],
    holdingDepositPaymentMethod: "",
    buyerName: "",
    buyerAddress: "",
  });
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const [editDepositOpen, setEditDepositOpen] = useState(false);
  const [isEditingDeposit, setIsEditingDeposit] = useState(false);
  const [editDepositData, setEditDepositData] = useState({
    holdingDepositAmount: "",
    holdingDepositDate: "",
    holdingDepositPaymentMethod: "",
    buyerName: "",
    buyerAddress: "",
  });
  const [editSaleDialogOpen, setEditSaleDialogOpen] = useState(false);
  const [isSavingSale, setIsSavingSale] = useState(false);
  const [editSaleData, setEditSaleData] = useState({
    saleDate: "",
    salesInvoiceNumber: "",
    buyerName: "",
    buyerAddress: "",
    buyerEmail: "",
    buyerPhone: "",
    salePrice: "",
    saleVat: "",
    paymentMethod: "",
    numberOfPayments: "1",
    payments: [] as PaymentRow[],
    partExchangeAllowance: "",
    partExchangeMake: "",
    partExchangeModel: "",
    partExchangeRegistration: "",
    partExchangeMileage: "",
    saleNotes: "",
    invoiceNotes: "",
    financeCompanyName: "",
    financeCompanyAddress: "",
    financeCompanyEmail: "",
    extras: [] as { description: string; amount: string; vatable: boolean; vat: string; onFinanceInvoice: boolean }[],
  });
  const [selectedEditFinanceCompanyId, setSelectedEditFinanceCompanyId] = useState<string>("manual");
  const [editingPayments, setEditingPayments] = useState(false);
  const [isSavingPayments, setIsSavingPayments] = useState(false);
  const [paymentsDraft, setPaymentsDraft] = useState<PaymentRow[]>([]);

  // A VAT-qualifying vehicle must be sold as VAT-qualifying: the Sale VAT is
  // charged at the settings VAT rate on the net sale price (read-only).
  useEffect(() => {
    if (!saleDialogOpen) return;
    if (vehicle?.vatQualifying && settings?.vatRate) {
      const rate = Number(settings.vatRate);
      const net = Number(saleData.salePrice) || 0;
      if (!Number.isNaN(rate)) {
        const vat = String(Math.round(net * (rate / 100) * 100) / 100);
        setSaleData((prev) => (prev.saleVat === vat ? prev : { ...prev, saleVat: vat }));
      }
    }
  }, [saleDialogOpen, saleData.salePrice, settings?.vatRate]);

  useEffect(() => {
    if (!editSaleDialogOpen) return;
    if (vehicle?.vatQualifying && settings?.vatRate) {
      const rate = Number(settings.vatRate);
      const net = Number(editSaleData.salePrice) || 0;
      if (!Number.isNaN(rate)) {
        const vat = String(Math.round(net * (rate / 100) * 100) / 100);
        setEditSaleData((prev) => (prev.saleVat === vat ? prev : { ...prev, saleVat: vat }));
      }
    }
  }, [editSaleDialogOpen, editSaleData.salePrice, settings?.vatRate]);

  if (isLoading) return <div className="p-8">Loading vehicle details...</div>;
  if (!vehicle) return <div className="p-8">Vehicle not found.</div>;

  const openEditDialog = () => {
    if (!vehicle) return;
    setEditData({
      registrationNumber: normalizeRegistration(vehicle.registrationNumber),
      make: vehicle.make,
      model: vehicle.model,
      vin: vehicle.vin ?? "",
      colour: vehicle.colour ?? "",
      description: vehicle.description ?? "",
      mileageAtPurchase: vehicle.mileageAtPurchase != null ? String(vehicle.mileageAtPurchase) : "",
      purchaseDate: vehicle.purchaseDate,
      purchasePrice: String(vehicle.purchasePrice),
      vatQualifying: vehicle.vatQualifying,
      purchaseVat: vehicle.purchaseVat != null ? String(vehicle.purchaseVat) : "",
      purchaseType: vehicle.purchaseType,
      purchaseInvoiceNumber: vehicle.purchaseInvoiceNumber ?? "",
      auctionCostNoVat: vehicle.auctionCostNoVat != null ? String(vehicle.auctionCostNoVat) : "",
      auctionCostWithVat: vehicle.auctionCostWithVat != null ? String(vehicle.auctionCostWithVat) : "",
      sellerName: vehicle.sellerName,
      sellerAddress: vehicle.sellerAddress ?? "",
      purchaseNotes: vehicle.purchaseNotes ?? "",
      askingPrice: vehicle.askingPrice != null ? String(vehicle.askingPrice) : "",
      marketingDescription: vehicle.marketingDescription ?? "",
      published: vehicle.published ?? false,
      showroomSold: vehicle.showroomSold ?? false,
      photoUrls: vehicle.photoUrls ?? [],
    });
    const match = sellers.find((s) => s.name.trim().toLowerCase() === vehicle.sellerName.trim().toLowerCase());
    setSelectedSellerId(match ? String(match.id) : "new");
    setEditDialogOpen(true);
  };

  const handleSellerSelect = (value: string) => {
    setSelectedSellerId(value);
    if (value === "new") {
      setEditData((d) => ({ ...d, sellerName: "", sellerAddress: "" }));
      return;
    }
    const seller = sellers.find((s) => String(s.id) === value);
    if (seller) {
      setEditData((d) => ({ ...d, sellerName: seller.name, sellerAddress: seller.address ?? "" }));
    }
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await updateVehicle.mutateAsync({
        id: vehicleId,
        data: {
          registrationNumber: editData.registrationNumber,
          make: editData.make,
          model: editData.model,
          vin: editData.vin || undefined,
          colour: editData.colour || undefined,
          description: editData.description || undefined,
          mileageAtPurchase: editData.mileageAtPurchase ? Number(editData.mileageAtPurchase) : undefined,
          purchaseDate: editData.purchaseDate,
          purchasePrice: Number(editData.purchasePrice),
          vatQualifying: editData.vatQualifying,
          purchaseVat:
            editData.vatQualifying && editData.purchaseVat
              ? Number(editData.purchaseVat)
              : null,
          purchaseType: editData.purchaseType as "private" | "auction" | "trade" | "part_exchange" | "other" | "cazoo_import",
          purchaseInvoiceNumber: editData.purchaseInvoiceNumber.trim(),
          auctionCostNoVat:
            editData.purchaseType === "auction" && editData.auctionCostNoVat
              ? Number(editData.auctionCostNoVat)
              : undefined,
          auctionCostWithVat:
            editData.purchaseType === "auction" && editData.auctionCostWithVat
              ? Number(editData.auctionCostWithVat)
              : undefined,
          sellerName: editData.sellerName,
          sellerAddress: editData.sellerAddress || undefined,
          purchaseNotes: editData.purchaseNotes || undefined,
          askingPrice: editData.askingPrice ? Number(editData.askingPrice) : null,
          marketingDescription: editData.marketingDescription || null,
          published: editData.published,
          showroomSold: editData.showroomSold,
          photoUrls: editData.photoUrls,
        },
      });
      toast({ title: "Vehicle updated" });
      invalidateVehicleData();
      setEditDialogOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.data?.error ?? err?.message ?? "Failed to update vehicle" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this vehicle?")) return;
    setIsDeleting(true);
    try {
      await deleteVehicle.mutateAsync({ id: vehicleId });
      toast({ title: "Vehicle deleted" });
      invalidateVehicleData();
      setLocation("/stock");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.error || "Failed to delete" });
      setIsDeleting(false);
    }
  };

  const handleRecordSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      Number(saleData.partExchangeAllowance) > 0 &&
      (!saleData.partExchangeMake.trim() || !saleData.partExchangeModel.trim() || !saleData.partExchangeRegistration.trim())
    ) {
      toast({
        variant: "destructive",
        title: "Part exchange details required",
        description: "Enter the part exchange make, model and registration when a part exchange price is entered.",
      });
      return;
    }
    setIsSelling(true);
    try {
      // Work out the deposit, extras and balance payable up front so they can be
      // shared between the sale record, the invoice, and (on finance sales) the
      // auto-generated finance payment in the payment schedule.
      const heldDeposit = vehicle.holdingDepositAmount ?? 0;
      const cleanedExtras = saleExtras
        .filter(e => e.description.trim() && e.amount !== "" && Number.isFinite(Number(e.amount)))
        .map(e => {
          const vat = computeExtraVat(e.amount, e.vatable);
          return {
            description: e.description.trim(),
            amount: Number(e.amount),
            vat: vat > 0 ? vat : undefined,
            // Only finance sales can route an extra onto the finance invoice;
            // otherwise every extra goes on the separate extras invoice.
            onFinanceInvoice: isFinanceSale ? e.onFinanceInvoice : false,
          };
        });
      // Each extra is billed either on the finance invoice or on a separate
      // extras invoice. Only the finance-invoice extras (gross) are added to the
      // balance payable.
      const extrasOnFinanceInvoice = cleanedExtras.some(e => e.onFinanceInvoice);
      const balancePayable = computeInvoiceBalancePayable({
        salePrice: Number(saleData.salePrice),
        saleVat: vehicle.vatQualifying && saleData.saleVat ? Number(saleData.saleVat) : 0,
        partExchangeAllowance: saleData.partExchangeAllowance ? Number(saleData.partExchangeAllowance) : 0,
        holdingDeposit: heldDeposit,
        extras: cleanedExtras,
        extrasOnFinanceInvoice,
      });

      // 1. Record Sale
      await recordSale.mutateAsync({
        id: vehicleId,
        data: {
          saleDate: saleData.saleDate,
          salesInvoiceNumber: saleData.salesInvoiceNumber,
          buyerName: saleData.buyerName,
          buyerAddress: saleData.buyerAddress,
          buyerEmail: saleData.buyerEmail.trim() || undefined,
          buyerPhone: saleData.buyerPhone.trim() || undefined,
          salePrice: Number(saleData.salePrice),
          saleVat: vehicle.vatQualifying && saleData.saleVat ? Number(saleData.saleVat) : undefined,
          paymentMethod: saleData.paymentMethod || undefined,
          partExchangeAllowance: saleData.partExchangeAllowance ? Number(saleData.partExchangeAllowance) : undefined,
          partExchangeMake: saleData.partExchangeMake || undefined,
          partExchangeModel: saleData.partExchangeModel || undefined,
          partExchangeRegistration: saleData.partExchangeRegistration || undefined,
          partExchangeMileage: saleData.partExchangeMileage ? Number(saleData.partExchangeMileage) : undefined,
          saleNotes: saleData.saleNotes || undefined,
          invoiceNotes: saleData.invoiceNotes.trim() || undefined,
          methodOfDisposal: "retail_sale"
        }
      });
      // 2. Generate Invoice Record
      await createInvoice.mutateAsync({
        id: vehicleId,
        data: {
          invoiceNumber: saleData.salesInvoiceNumber,
          invoiceDate: saleData.saleDate,
          customerName: saleData.buyerName,
          customerAddress: saleData.buyerAddress,
          salePrice: Number(saleData.salePrice),
          saleVat: vehicle.vatQualifying && saleData.saleVat ? Number(saleData.saleVat) : undefined,
          paymentMethod: saleData.paymentMethod || undefined,
          partExchangeAllowance: saleData.partExchangeAllowance ? Number(saleData.partExchangeAllowance) : undefined,
          holdingDeposit: heldDeposit > 0 ? heldDeposit : undefined,
          extras: cleanedExtras.length ? cleanedExtras : undefined,
          extrasOnFinanceInvoice: extrasOnFinanceInvoice || undefined,
          balancePayable,
          notes: saleData.saleNotes,
          financeCompanyName: isFinanceSale && saleData.financeCompanyName.trim() ? saleData.financeCompanyName.trim() : undefined,
          financeCompanyAddress: isFinanceSale && saleData.financeCompanyAddress.trim() ? saleData.financeCompanyAddress.trim() : undefined,
          financeCompanyEmail: isFinanceSale && saleData.financeCompanyEmail.trim() ? saleData.financeCompanyEmail.trim() : undefined
        }
      });
      
      toast({ title: "Sale recorded successfully" });
      setSaleExtras([]);
      invalidateVehicleData();
      setSaleDialogOpen(false);
      // If the vehicle was live on the public website, ask whether to remove it
      // now, in 7 days, or leave it for the dealer to remove manually later.
      if (settings?.showroomEnabled && vehicle.published) {
        setRemovalDialogOpen(true);
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.error || "Failed to record sale" });
    } finally {
      setIsSelling(false);
    }
  };

  // Apply the dealer's choice for removing a just-sold vehicle from the public
  // website. The server owns the timing rules (immediate, +7 days, or never).
  const handleShowroomRemoval = async (mode: "now" | "in_7_days" | "manual") => {
    setRemovalSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`${basePath}/api/vehicles/${vehicleId}/showroom-removal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      toast({
        title:
          mode === "now"
            ? "Removed from the website"
            : mode === "in_7_days"
              ? "Will be removed from the website in 7 days"
              : "Kept on the website",
      });
      invalidateVehicleData();
      setRemovalDialogOpen(false);
    } catch {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not update the website listing. Please try again.",
      });
    } finally {
      setRemovalSubmitting(false);
    }
  };

  const handleRecordHoldingDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(Number(depositData.holdingDepositAmount) > 0)) {
      toast({
        variant: "destructive",
        title: "Deposit amount required",
        description: "Enter a holding deposit amount greater than zero.",
      });
      return;
    }
    setIsDepositing(true);
    try {
      const updated = await recordHoldingDeposit.mutateAsync({
        id: vehicleId,
        data: {
          holdingDepositAmount: Number(depositData.holdingDepositAmount),
          holdingDepositDate: depositData.holdingDepositDate,
          holdingDepositPaymentMethod: depositData.holdingDepositPaymentMethod || undefined,
          buyerName: depositData.buyerName,
          buyerAddress: depositData.buyerAddress,
        },
      });
      if (settings) {
        await generateHoldingDepositPdf(
          {
            reference: updated.holdingDepositReference ?? "",
            date: updated.holdingDepositDate ?? depositData.holdingDepositDate,
            amount: updated.holdingDepositAmount ?? Number(depositData.holdingDepositAmount),
            customerName: updated.buyerName ?? depositData.buyerName,
            customerAddress: updated.buyerAddress ?? depositData.buyerAddress,
          },
          updated,
          settings,
        );
      }
      toast({ title: "Holding deposit recorded — vehicle reserved" });
      setDepositDialogOpen(false);
      invalidateVehicleData();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.data?.error ?? err?.message ?? "Failed to record holding deposit" });
    } finally {
      setIsDepositing(false);
    }
  };

  const openEditDeposit = () => {
    if (!vehicle) return;
    setEditDepositData({
      holdingDepositAmount: vehicle.holdingDepositAmount != null ? String(vehicle.holdingDepositAmount) : "",
      holdingDepositDate: vehicle.holdingDepositDate ?? "",
      holdingDepositPaymentMethod: vehicle.holdingDepositPaymentMethod ?? "",
      buyerName: vehicle.buyerName ?? "",
      buyerAddress: vehicle.buyerAddress ?? "",
    });
    setEditDepositOpen(true);
  };

  const handleEditDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(Number(editDepositData.holdingDepositAmount) > 0)) {
      toast({
        variant: "destructive",
        title: "Deposit amount required",
        description: "Enter a holding deposit amount greater than zero.",
      });
      return;
    }
    setIsEditingDeposit(true);
    try {
      await recordHoldingDeposit.mutateAsync({
        id: vehicleId,
        data: {
          holdingDepositAmount: Number(editDepositData.holdingDepositAmount),
          holdingDepositDate: editDepositData.holdingDepositDate,
          holdingDepositPaymentMethod: editDepositData.holdingDepositPaymentMethod || undefined,
          buyerName: editDepositData.buyerName,
          buyerAddress: editDepositData.buyerAddress,
        },
      });
      toast({ title: "Holding deposit updated" });
      invalidateVehicleData();
      setEditDepositOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.data?.error ?? err?.message ?? "Failed to update holding deposit" });
    } finally {
      setIsEditingDeposit(false);
    }
  };

  const handleRefundDeposit = async () => {
    if (!vehicle) return;
    setIsRefunding(true);
    try {
      await refundHoldingDeposit.mutateAsync({ id: vehicleId });
      setSaleData(prev => ({
        ...prev,
        buyerName: "",
        buyerAddress: "",
      }));
      toast({ title: "Deposit refunded — vehicle back in stock" });
      invalidateVehicleData();
      setRefundDialogOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.data?.error ?? err?.message ?? "Failed to refund deposit" });
    } finally {
      setIsRefunding(false);
    }
  };

  const openEditSaleDialog = async () => {
    if (!vehicle) return;
    // Always prefill extras from fresh invoice data. The invoice query may not
    // have loaded yet right after recording a sale; opening with stale/empty
    // extras would cause the save to wipe them.
    let invoiceForPrefill = vehicleInvoice;
    if (vehicle.status === "sold") {
      try {
        const { data } = await refetchVehicleInvoice();
        if (data) invoiceForPrefill = data;
      } catch {
        // fall back to cached invoice data
      }
    }
    const existingPayments: PaymentRow[] = (vehicle.payments ?? []).map(p => ({
      date: p.date ?? "",
      amount: p.amount != null ? String(p.amount) : "",
      paymentMethod: p.paymentMethod ?? "",
      type: p.type ?? "",
    }));
    setEditSaleData({
      saleDate: vehicle.saleDate ?? "",
      salesInvoiceNumber: vehicle.salesInvoiceNumber ?? "",
      buyerName: vehicle.buyerName ?? "",
      buyerAddress: vehicle.buyerAddress ?? "",
      buyerEmail: vehicle.buyerEmail ?? "",
      buyerPhone: vehicle.buyerPhone ?? "",
      salePrice: vehicle.salePrice != null ? String(vehicle.salePrice) : "",
      saleVat: vehicle.saleVat != null ? String(vehicle.saleVat) : "",
      paymentMethod: vehicle.paymentMethod ?? "",
      numberOfPayments: vehicle.numberOfPayments != null ? String(vehicle.numberOfPayments) : "",
      payments: vehicle.numberOfPayments != null ? resizePayments(existingPayments, vehicle.numberOfPayments) : existingPayments,
      partExchangeAllowance:
        vehicle.partExchangeAllowance != null ? String(vehicle.partExchangeAllowance) : "",
      partExchangeMake: vehicle.partExchangeMake ?? "",
      partExchangeModel: vehicle.partExchangeModel ?? "",
      partExchangeRegistration: normalizeRegistration(vehicle.partExchangeRegistration ?? ""),
      partExchangeMileage:
        vehicle.partExchangeMileage != null ? String(vehicle.partExchangeMileage) : "",
      saleNotes: vehicle.saleNotes ?? "",
      invoiceNotes: vehicle.invoiceNotes ?? "",
      financeCompanyName: invoiceForPrefill?.financeCompanyName ?? "",
      financeCompanyAddress: invoiceForPrefill?.financeCompanyAddress ?? "",
      financeCompanyEmail: invoiceForPrefill?.financeCompanyEmail ?? "",
      extras: (invoiceForPrefill?.extras ?? []).map(e => ({
        description: e.description,
        amount: String(e.amount),
        vatable: (e.vat ?? 0) > 0,
        vat: e.vat != null ? String(e.vat) : "",
        // Legacy invoices have no per-item flag; fall back to the old
        // invoice-level choice so existing extras keep their finance routing.
        onFinanceInvoice: e.onFinanceInvoice ?? invoiceForPrefill?.extrasOnFinanceInvoice ?? false,
      })),
    });
    // Match the stored finance company to a saved one so the picker reflects it;
    // otherwise fall back to manual entry with the stored details.
    const matched = financeCompanies.find(
      c => (c.name ?? "") === (invoiceForPrefill?.financeCompanyName ?? ""),
    );
    setSelectedEditFinanceCompanyId(
      invoiceForPrefill?.financeCompanyName && matched ? String(matched.id) : "manual",
    );
    setEditSaleDialogOpen(true);
  };

  const handleEditSaleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      Number(editSaleData.partExchangeAllowance) > 0 &&
      (!editSaleData.partExchangeMake.trim() || !editSaleData.partExchangeModel.trim() || !editSaleData.partExchangeRegistration.trim())
    ) {
      toast({
        variant: "destructive",
        title: "Part exchange details required",
        description: "Enter the part exchange make, model and registration when a part exchange price is entered.",
      });
      return;
    }
    setIsSavingSale(true);
    const cleanedEditExtras = editSaleData.extras
      .filter(x => x.description.trim() && x.amount !== "" && Number.isFinite(Number(x.amount)))
      .map(x => {
        // Preserve the stored VAT value; it is only recomputed when the user
        // toggles VAT or edits the amount, so an unrelated edit never silently
        // rewrites VAT (e.g. if the dealer's VAT rate has since changed).
        const vat = x.vatable && x.vat !== "" ? Number(x.vat) : undefined;
        return {
          description: x.description.trim(),
          amount: Number(x.amount),
          vat: vat != null && vat > 0 ? vat : undefined,
          // Only finance sales can route an extra onto the finance invoice;
          // otherwise every extra goes on the separate extras invoice.
          onFinanceInvoice: editSaleData.financeCompanyName.trim() !== "" ? x.onFinanceInvoice : false,
        };
      });
    try {
      await updateVehicle.mutateAsync({
        id: vehicleId,
        data: {
          saleDate: editSaleData.saleDate,
          salesInvoiceNumber: editSaleData.salesInvoiceNumber,
          buyerName: editSaleData.buyerName,
          buyerAddress: editSaleData.buyerAddress,
          buyerEmail: editSaleData.buyerEmail.trim() || null,
          buyerPhone: editSaleData.buyerPhone.trim() || null,
          salePrice: Number(editSaleData.salePrice),
          saleVat: vehicle.vatQualifying && editSaleData.saleVat ? Number(editSaleData.saleVat) : null,
          paymentMethod: editSaleData.paymentMethod || undefined,
          numberOfPayments: editSaleData.numberOfPayments ? Number(editSaleData.numberOfPayments) : null,
          payments: editSaleData.numberOfPayments && editSaleData.payments.length
            ? editSaleData.payments.map(p => ({ date: p.date, amount: p.amount ? Number(p.amount) : 0, paymentMethod: p.paymentMethod || undefined, type: p.type || undefined }))
            : null,
          partExchangeAllowance: editSaleData.partExchangeAllowance
            ? Number(editSaleData.partExchangeAllowance)
            : undefined,
          partExchangeMake: editSaleData.partExchangeMake || null,
          partExchangeModel: editSaleData.partExchangeModel || null,
          partExchangeRegistration: editSaleData.partExchangeRegistration || null,
          partExchangeMileage: editSaleData.partExchangeMileage ? Number(editSaleData.partExchangeMileage) : null,
          saleNotes: editSaleData.saleNotes || undefined,
          invoiceNotes: editSaleData.invoiceNotes.trim() || null,
          financeCompanyName: editSaleData.financeCompanyName.trim() || null,
          financeCompanyAddress: editSaleData.financeCompanyAddress.trim() || null,
          financeCompanyEmail: editSaleData.financeCompanyEmail.trim() || null,
          extras: cleanedEditExtras,
          extrasOnFinanceInvoice: cleanedEditExtras.some(e => e.onFinanceInvoice),
        },
      });
      toast({ title: "Sale details updated" });
      invalidateVehicleData();
      setEditSaleDialogOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.data?.error ?? err?.message ?? "Failed to update sale details" });
    } finally {
      setIsSavingSale(false);
    }
  };

  const startEditingPayments = () => {
    if (!vehicle) return;
    setPaymentsDraft(
      (vehicle.payments ?? []).map(p => ({
        date: p.date ?? "",
        amount: p.amount != null ? String(p.amount) : "",
        paymentMethod: p.paymentMethod ?? "",
        type: p.type ?? "",
      }))
    );
    setEditingPayments(true);
  };

  const cancelEditingPayments = () => {
    setEditingPayments(false);
    setPaymentsDraft([]);
  };

  const addPaymentRow = () => {
    setPaymentsDraft(rows => [...rows, { date: "", amount: "", paymentMethod: "", type: "" }]);
  };

  const removePaymentRow = (i: number) => {
    setPaymentsDraft(rows => rows.filter((_, idx) => idx !== i));
  };

  const handleSavePayments = async () => {
    setIsSavingPayments(true);
    try {
      await updateVehicle.mutateAsync({
        id: vehicleId,
        data: {
          numberOfPayments: paymentsDraft.length || null,
          payments: paymentsDraft.length
            ? paymentsDraft.map(p => ({ date: p.date, amount: p.amount ? Number(p.amount) : 0, paymentMethod: p.paymentMethod || undefined, type: p.type || undefined }))
            : null,
        },
      });
      toast({ title: "Payments updated" });
      invalidateVehicleData();
      setEditingPayments(false);
      setPaymentsDraft([]);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.data?.error ?? err?.message ?? "Failed to update payments" });
    } finally {
      setIsSavingPayments(false);
    }
  };

  // Surface any client-side PDF generation failure as a toast instead of
  // letting the rejected promise bubble up as an unhandled runtime error.
  const runPdf = (promise: Promise<unknown>, what: string) => {
    promise.catch(() => {
      toast({
        variant: "destructive",
        title: "Error",
        description: `Failed to generate the ${what}. Please try again.`,
      });
    });
  };

  const generatePDF = () => {
    if (!vehicle || !settings) return;
    const invoiceData = {
      invoiceNumber: vehicle.salesInvoiceNumber ?? "",
      invoiceDate: vehicle.saleDate ?? "",
      customerName: vehicle.buyerName ?? "",
      customerAddress: vehicle.buyerAddress ?? "",
      salePrice: vehicle.salePrice ?? 0,
      saleVat: vehicle.saleVat,
      partExchangeAllowance: vehicle.partExchangeAllowance,
      holdingDeposit: vehicle.holdingDepositAmount,
      financeCompanyName: vehicleInvoice?.financeCompanyName,
      financeCompanyAddress: vehicleInvoice?.financeCompanyAddress,
      financeCompanyEmail: vehicleInvoice?.financeCompanyEmail,
      invoiceNotes: vehicle.invoiceNotes ?? undefined,
      // Only extras flagged for the finance invoice appear here; the rest go on
      // the separate extras PDF. Legacy extras have no per-item flag, so fall
      // back to the old invoice-level choice.
      extras: (() => {
        const onFin = selectFinanceInvoiceExtras(
          vehicleInvoice?.extras,
          vehicleInvoice?.extrasOnFinanceInvoice,
        );
        return onFin.length ? onFin : undefined;
      })(),
    };
    // VAT-qualifying vehicles get a standard VAT invoice (net + separate VAT);
    // all others get the margin-scheme sales invoice.
    runPdf(
      vehicle.vatQualifying
        ? generateVatVehicleInvoicePdf(invoiceData, vehicle, settings)
        : generateInvoicePdf(invoiceData, vehicle, settings),
      "invoice PDF",
    );
  };

  const generateExtrasPDF = () => {
    if (!vehicle || !settings) return;
    // The separate extras invoice carries only the extras NOT billed on the
    // finance invoice. Legacy extras fall back to the old invoice-level choice.
    const extras = selectSeparateInvoiceExtras(
      vehicleInvoice?.extras,
      vehicleInvoice?.extrasOnFinanceInvoice,
    );
    if (extras.length === 0) return;
    runPdf(
      generateExtrasInvoicePdf(
        {
          invoiceNumber: `${vehicle.salesInvoiceNumber ?? ""}A`,
          invoiceDate: vehicle.saleDate ?? "",
          customerName: vehicle.buyerName ?? "",
          customerAddress: vehicle.buyerAddress ?? "",
          extras,
        },
        vehicle,
        settings,
      ),
      "extras invoice PDF",
    );
  };

  const downloadHoldingDepositReceipt = () => {
    if (!vehicle || !settings) return;
    runPdf(
      generateHoldingDepositPdf(
        {
          reference: vehicle.holdingDepositReference ?? "",
          date: vehicle.holdingDepositDate ?? "",
          amount: vehicle.holdingDepositAmount ?? 0,
          customerName: vehicle.buyerName ?? "",
          customerAddress: vehicle.buyerAddress ?? "",
        },
        vehicle,
        settings,
      ),
      "holding deposit receipt",
    );
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/stock")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{vehicle.registrationNumber}</h1>
            <p className="text-slate-500">{vehicle.make} {vehicle.model}</p>
          </div>
          <Badge
            variant={vehicle.status === 'in_stock' ? 'default' : vehicle.status === 'reserved' ? 'outline' : 'secondary'}
            className={`ml-4${vehicle.status === 'reserved' ? ' border-amber-500 text-amber-700' : ''}`}
          >
            {vehicle.status.replace('_', ' ').toUpperCase()}
          </Badge>
        </div>
        <div className="flex gap-2">
          {vehicle.status === 'in_stock' && (
            <Dialog open={depositDialogOpen} onOpenChange={setDepositDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Wallet className="h-4 w-4 mr-2" />
                  Take Deposit
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Take Holding Deposit</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-slate-500">
                  Reserves this vehicle and generates a branded holding-deposit receipt. The buyer details and deposit carry through to Record Sale.
                </p>
                <form onSubmit={handleRecordHoldingDeposit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Deposit Amount (£) *</Label>
                      <Input type="number" step="0.01" min="0" required value={depositData.holdingDepositAmount} onChange={e => setDepositData({...depositData, holdingDepositAmount: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>Deposit Date *</Label>
                      <Input type="date" required value={depositData.holdingDepositDate} onChange={e => setDepositData({...depositData, holdingDepositDate: e.target.value})} />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>Payment Method</Label>
                      <Select value={depositData.holdingDepositPaymentMethod} onValueChange={value => setDepositData({...depositData, holdingDepositPaymentMethod: value})}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a payment method" />
                        </SelectTrigger>
                        <SelectContent>
                          {HOLDING_DEPOSIT_PAYMENT_METHODS.map(m => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>Buyer Name *</Label>
                      <Input required value={depositData.buyerName} onChange={e => setDepositData({...depositData, buyerName: e.target.value})} />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>Buyer Address *</Label>
                      <Textarea required value={depositData.buyerAddress} onChange={e => setDepositData({...depositData, buyerAddress: e.target.value})} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setDepositDialogOpen(false)} disabled={isDepositing}>Cancel</Button>
                    <Button type="submit" disabled={isDepositing}>
                      {isDepositing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Reserve &amp; Generate Receipt
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
          {(vehicle.status === 'in_stock' || vehicle.status === 'reserved') && (
            <Dialog open={saleDialogOpen} onOpenChange={(open) => {
              setSaleDialogOpen(open);
              if (open) {
                if (vehicle.buyerName || vehicle.buyerAddress) {
                  setSaleData(prev => ({
                    ...prev,
                    buyerName: prev.buyerName || (vehicle.buyerName ?? ""),
                    buyerAddress: prev.buyerAddress || (vehicle.buyerAddress ?? ""),
                  }));
                }
                if (!saleData.salesInvoiceNumber) {
                  getNextInvoiceNumber().then(({ invoiceNumber }) =>
                    setSaleData(prev => prev.salesInvoiceNumber ? prev : { ...prev, salesInvoiceNumber: invoiceNumber })
                  ).catch(() => {});
                }
              }
            }}>
              <DialogTrigger asChild>
                <Button className="bg-green-600 hover:bg-green-700" onClick={() => { setIsFinanceSale(false); setSaleExtras([]); }}>
                  <PoundSterling className="h-4 w-4 mr-2" />
                  Record Sale
                </Button>
              </DialogTrigger>
              <DialogTrigger asChild>
                <Button className="bg-black hover:bg-zinc-800 text-white" onClick={() => {
                  setIsFinanceSale(true);
                  setSaleExtras([]);
                  setSelectedFinanceCompanyId("manual");
                  setSaleData(prev => ({ ...prev, financeCompanyName: "", financeCompanyAddress: "", financeCompanyEmail: "" }));
                }}>
                  <PoundSterling className="h-4 w-4 mr-2" />
                  Record Finance Sale
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{isFinanceSale ? "Record Finance Sale" : "Record Sale"}</DialogTitle>
                </DialogHeader>
                {vehicle.status === 'reserved' && vehicle.holdingDepositAmount != null && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    A holding deposit of {formatCurrency(vehicle.holdingDepositAmount)} has been paid and will be deducted from the balance payable on the invoice.
                  </div>
                )}
                <form onSubmit={handleRecordSale} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Sale Date *</Label>
                      <Input type="date" required value={saleData.saleDate} onChange={e => setSaleData({...saleData, saleDate: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>Invoice Number *</Label>
                      <Input required readOnly value={saleData.salesInvoiceNumber} className="bg-muted" />
                      <p className="text-xs text-muted-foreground">Auto-generated.</p>
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>Buyer Name *</Label>
                      <Input required value={saleData.buyerName} onChange={e => setSaleData({...saleData, buyerName: e.target.value})} />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>Buyer Address *</Label>
                      <Textarea required value={saleData.buyerAddress} onChange={e => setSaleData({...saleData, buyerAddress: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>Buyer Email</Label>
                      <Input type="email" value={saleData.buyerEmail} onChange={e => setSaleData({...saleData, buyerEmail: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>Buyer Telephone</Label>
                      <Input type="tel" value={saleData.buyerPhone} onChange={e => setSaleData({...saleData, buyerPhone: e.target.value})} />
                    </div>
                    {isFinanceSale && (
                      <div className="col-span-2 space-y-3 rounded-md border border-indigo-200 bg-indigo-50/50 p-3">
                        <p className="text-sm font-medium text-indigo-900">Finance Company</p>
                        <div className="space-y-2">
                          <Label>Choose a saved finance company</Label>
                          <Select
                            value={selectedFinanceCompanyId}
                            onValueChange={(value) => {
                              setSelectedFinanceCompanyId(value);
                              if (value === "manual") {
                                setSaleData(prev => ({ ...prev, financeCompanyName: "", financeCompanyAddress: "", financeCompanyEmail: "" }));
                              } else {
                                const fc = financeCompanies.find(c => String(c.id) === value);
                                if (fc) {
                                  setSaleData(prev => ({
                                    ...prev,
                                    financeCompanyName: fc.name ?? "",
                                    financeCompanyAddress: fc.address ?? "",
                                    financeCompanyEmail: fc.email ?? "",
                                  }));
                                }
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select a finance company" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="manual">Enter details manually</SelectItem>
                              {financeCompanies.map(c => (
                                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">Saved finance companies are managed in the Finance Companies section. Selecting one fills the fields below, which you can still edit.</p>
                        </div>
                        <div className="space-y-2">
                          <Label>Finance Company Name</Label>
                          <Input value={saleData.financeCompanyName} onChange={e => setSaleData({...saleData, financeCompanyName: e.target.value})} />
                        </div>
                        <div className="space-y-2">
                          <Label>Finance Company Address</Label>
                          <Textarea value={saleData.financeCompanyAddress} onChange={e => setSaleData({...saleData, financeCompanyAddress: e.target.value})} />
                        </div>
                        <div className="space-y-2">
                          <Label>Finance Company Email</Label>
                          <Input type="email" value={saleData.financeCompanyEmail} onChange={e => setSaleData({...saleData, financeCompanyEmail: e.target.value})} />
                        </div>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>{vehicle.vatQualifying ? "Sale Price (Net £) *" : "Sale Price (£) *"}</Label>
                      <Input type="number" step="0.01" required value={saleData.salePrice} onChange={e => setSaleData({...saleData, salePrice: e.target.value})} />
                    </div>
                    {vehicle.vatQualifying && (
                      <div className="space-y-2">
                        <Label>Sale VAT (£)</Label>
                        <Input type="number" step="0.01" readOnly value={saleData.saleVat} />
                        <p className="text-xs text-muted-foreground">Calculated automatically at the {settings?.vatRate ? `${settings.vatRate}%` : "settings"} VAT rate on the net sale price.</p>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Part Exchange Price Paid (£)</Label>
                      <Input type="number" step="0.01" value={saleData.partExchangeAllowance} onChange={e => setSaleData({...saleData, partExchangeAllowance: e.target.value})} />
                    </div>
                    <div className="col-span-2 grid grid-cols-3 gap-4 rounded-md border border-slate-200 p-3">
                      <p className="col-span-3 text-sm text-slate-500">Part exchange vehicle details — make, model and registration are required when a part exchange price is entered, and the vehicle is added to your stock book.</p>
                      <div className="space-y-2">
                        <Label>PX Make{Number(saleData.partExchangeAllowance) > 0 ? " *" : ""}</Label>
                        <Input value={saleData.partExchangeMake} onChange={e => setSaleData({...saleData, partExchangeMake: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label>PX Model{Number(saleData.partExchangeAllowance) > 0 ? " *" : ""}</Label>
                        <Input value={saleData.partExchangeModel} onChange={e => setSaleData({...saleData, partExchangeModel: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label>PX Registration{Number(saleData.partExchangeAllowance) > 0 ? " *" : ""}</Label>
                        <RegistrationLookup
                          value={saleData.partExchangeRegistration}
                          active={saleDialogOpen}
                          partExchange
                          required={Number(saleData.partExchangeAllowance) > 0}
                          onChange={(partExchangeRegistration) => setSaleData({ ...saleData, partExchangeRegistration })}
                          fields={{ make: saleData.partExchangeMake, model: saleData.partExchangeModel }}
                          onFill={(values) => setSaleData((current) => ({ ...current, ...mapRegistrationLookupToPartExchange(values) }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>PX Mileage</Label>
                        <Input type="number" min="0" value={saleData.partExchangeMileage} onChange={e => setSaleData({...saleData, partExchangeMileage: e.target.value})} />
                      </div>
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>Invoice Note</Label>
                      <p className="text-xs text-slate-500">If entered, this text appears on the invoice underneath the vehicle details.</p>
                      <Textarea value={saleData.invoiceNotes} onChange={e => setSaleData({...saleData, invoiceNotes: e.target.value})} />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <div className="flex items-center justify-between">
                        <Label>Invoice Extras</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSaleExtras([...saleExtras, { description: "", amount: "", vatable: false, onFinanceInvoice: false }])}
                        >
                          Add Extra
                        </Button>
                      </div>
                      <p className="text-sm text-slate-500">
                        Optional additional charges (e.g. warranty, admin fee, delivery). Enter the net amount and tick VAT to charge it — the VAT is calculated automatically at your {vatRatePct ? `${vatRatePct}%` : "Settings"} VAT rate.
                        {isFinanceSale
                          ? " For each extra, tick \"On finance invoice\" to add it to the finance company's invoice; leave it unticked to bill it on a separate extras invoice to the customer."
                          : " These are billed on a separate standard VAT invoice (the car invoice number with an \"A\" suffix), not on the car sales invoice."}
                      </p>
                      {!vatRatePct && (
                        <p className="text-sm text-amber-600">Set your VAT rate in Settings to charge VAT on extras.</p>
                      )}
                      {saleExtras.map((extra, i) => (
                        <div key={i} className="flex gap-2 items-start">
                          <Input
                            placeholder="Description"
                            value={extra.description}
                            onChange={e => setSaleExtras(saleExtras.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))}
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Amount (£)"
                            value={extra.amount}
                            onChange={e => setSaleExtras(saleExtras.map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x))}
                            className="w-32"
                          />
                          <div className="flex h-10 w-36 items-center gap-2 shrink-0">
                            <Checkbox
                              id={`sale-extra-vat-${i}`}
                              checked={extra.vatable}
                              onCheckedChange={(checked) => setSaleExtras(saleExtras.map((x, idx) => idx === i ? { ...x, vatable: checked === true } : x))}
                            />
                            <Label htmlFor={`sale-extra-vat-${i}`} className="font-normal whitespace-nowrap text-sm">
                              VAT{extra.vatable && extra.amount ? ` £${computeExtraVat(extra.amount, true).toFixed(2)}` : ""}
                            </Label>
                          </div>
                          {isFinanceSale && (
                            <div className="flex h-10 w-44 items-center gap-2 shrink-0">
                              <Checkbox
                                id={`sale-extra-fin-${i}`}
                                checked={extra.onFinanceInvoice}
                                onCheckedChange={(checked) => setSaleExtras(saleExtras.map((x, idx) => idx === i ? { ...x, onFinanceInvoice: checked === true } : x))}
                              />
                              <Label htmlFor={`sale-extra-fin-${i}`} className="font-normal whitespace-nowrap text-sm">
                                On finance invoice
                              </Label>
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => setSaleExtras(saleExtras.filter((_, idx) => idx !== i))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>Sale Notes</Label>
                      <Textarea value={saleData.saleNotes} onChange={e => setSaleData({...saleData, saleNotes: e.target.value})} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setSaleDialogOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={isSelling}>
                      {isSelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save Sale
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
          {vehicle.status === 'sold' && (
            <>
              <Button variant="outline" onClick={openEditSaleDialog}>
                <PoundSterling className="h-4 w-4 mr-2" />
                Edit Sale
              </Button>
              <Button variant="outline" onClick={generatePDF}>
                <FileText className="h-4 w-4 mr-2" />
                Download Invoice PDF
              </Button>
              {(vehicleInvoice?.extras ?? []).some(e => !(e.onFinanceInvoice ?? vehicleInvoice?.extrasOnFinanceInvoice)) && (
                <Button variant="outline" onClick={generateExtrasPDF}>
                  <FileText className="h-4 w-4 mr-2" />
                  Download Extras Invoice
                </Button>
              )}
            </>
          )}
          <Button variant="outline" size="icon" onClick={openEditDialog}>
            <Edit className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="text-red-600 hover:text-red-700" onClick={handleDelete} disabled={isDeleting}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={removalDialogOpen} onOpenChange={(open) => { if (!removalSubmitting) setRemovalDialogOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove from website?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This vehicle is on your public website. Now that it is sold, when would you like it removed?
          </p>
          <div className="space-y-3 pt-2">
            <Button type="button" variant="outline" className="w-full h-auto flex-col items-start gap-1 py-3 text-left whitespace-normal" disabled={removalSubmitting} onClick={() => handleShowroomRemoval("now")}>
              <span className="font-medium">Remove straight away</span>
              <span className="text-xs font-normal text-muted-foreground">Hidden from the website immediately.</span>
            </Button>
            <Button type="button" variant="outline" className="w-full h-auto flex-col items-start gap-1 py-3 text-left whitespace-normal" disabled={removalSubmitting} onClick={() => handleShowroomRemoval("in_7_days")}>
              <span className="font-medium">Remove automatically in 7 days</span>
              <span className="text-xs font-normal text-muted-foreground">Stays on with a SOLD banner, then removed for you after a week.</span>
            </Button>
            <Button type="button" variant="outline" className="w-full h-auto flex-col items-start gap-1 py-3 text-left whitespace-normal" disabled={removalSubmitting} onClick={() => handleShowroomRemoval("manual")}>
              <span className="font-medium">Keep on the website for now</span>
              <span className="text-xs font-normal text-muted-foreground">Stays on with a SOLD banner until you remove it yourself.</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Vehicle</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Registration Number *</Label>
                <RegistrationLookup
                  value={editData.registrationNumber}
                  active={editDialogOpen}
                  required
                  onChange={(registrationNumber) => setEditData({ ...editData, registrationNumber })}
                  fields={editData}
                  onFill={(values) => setEditData((current) => ({ ...current, ...values }))}
                />
              </div>
              <div className="space-y-2">
                <Label>VIN Number</Label>
                <Input value={editData.vin} onChange={e => setEditData({...editData, vin: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Make *</Label>
                <Input required value={editData.make} onChange={e => setEditData({...editData, make: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Model *</Label>
                <Input required value={editData.model} onChange={e => setEditData({...editData, model: e.target.value})} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Description</Label>
                <Textarea value={editData.description} onChange={e => setEditData({...editData, description: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Mileage</Label>
                <Input type="number" value={editData.mileageAtPurchase} onChange={e => setEditData({...editData, mileageAtPurchase: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Colour</Label>
                <Input value={editData.colour} onChange={e => setEditData({...editData, colour: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Purchase Date *</Label>
                <Input type="date" required value={editData.purchaseDate} onChange={e => setEditData({...editData, purchaseDate: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>{editData.vatQualifying ? "Purchase Price (Net £) *" : "Purchase Price (£) *"}</Label>
                <Input type="number" step="0.01" required value={editData.purchasePrice} onChange={e => setEditData({...editData, purchasePrice: e.target.value})} />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <Checkbox
                  id="edit-vat-qualifying"
                  checked={editData.vatQualifying}
                  disabled={vehicle.saleDate != null && vehicle.vatQualifying}
                  onCheckedChange={(checked) => setEditData({ ...editData, vatQualifying: checked === true })}
                />
                <Label htmlFor="edit-vat-qualifying" className="font-normal">VAT Qualifying Vehicle</Label>
              </div>
              {vehicle.saleDate != null && vehicle.vatQualifying && (
                <p className="col-span-2 -mt-1 text-xs text-slate-500">This vehicle has been sold as VAT-qualifying, so this cannot be removed.</p>
              )}
              {editData.vatQualifying && (
                <div className="space-y-2">
                  <Label>Purchase VAT (£)</Label>
                  <Input type="number" step="0.01" readOnly value={editData.purchaseVat} />
                  <p className="text-xs text-slate-500">Calculated automatically at the {settings?.vatRate ? `${settings.vatRate}%` : "settings"} VAT rate on the net purchase price.</p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Purchase Type *</Label>
                <Select value={editData.purchaseType} onValueChange={v => setEditData({...editData, purchaseType: v})}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="trade">Trade</SelectItem>
                    <SelectItem value="auction">Auction</SelectItem>
                    <SelectItem value="part_exchange">Part Exchange</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                    <SelectItem value="cazoo_import">Cazoo Import</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Purchase Invoice Ref</Label>
                <Input name="purchaseInvoiceRef" autoComplete="off" value={editData.purchaseInvoiceNumber} onChange={e => setEditData({...editData, purchaseInvoiceNumber: e.target.value})} />
              </div>
              {editData.purchaseType === "auction" && (
                <>
                  <div className="space-y-2">
                    <Label>Auction Costs That Have No VAT (£)</Label>
                    <Input type="number" step="0.01" value={editData.auctionCostNoVat} onChange={e => setEditData({...editData, auctionCostNoVat: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>Auction Costs That Have VAT (£)</Label>
                    <Input type="number" step="0.01" value={editData.auctionCostWithVat} onChange={e => setEditData({...editData, auctionCostWithVat: e.target.value})} />
                  </div>
                </>
              )}
              {settings?.showroomEnabled && (
              <div className="col-span-2 space-y-4 rounded-lg border border-slate-200 p-4">
                <div>
                  <h3 className="text-sm font-medium text-slate-900">Website</h3>
                  <p className="text-xs text-slate-500">Customer-facing photos, price and description. No accounting or purchase data is shown to customers.</p>
                </div>
                <div className="space-y-2">
                  <Label>Photos</Label>
                  <VehiclePhotosUploader
                    value={editData.photoUrls}
                    onChange={(urls) => setEditData({ ...editData, photoUrls: urls })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Asking Price (£)</Label>
                  <Input type="number" step="0.01" placeholder="e.g. 8995" value={editData.askingPrice} onChange={e => setEditData({...editData, askingPrice: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Marketing Description</Label>
                  <Textarea rows={4} placeholder="Highlight the vehicle's condition, features and history for buyers." value={editData.marketingDescription} onChange={e => setEditData({...editData, marketingDescription: e.target.value})} />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="edit-published"
                    checked={editData.published}
                    onCheckedChange={(checked) => setEditData({ ...editData, published: checked === true })}
                  />
                  <Label htmlFor="edit-published" className="font-normal">Publish to website (shown while in stock, hidden once sold)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="edit-showroom-sold"
                    checked={editData.showroomSold}
                    onCheckedChange={(checked) => setEditData({ ...editData, showroomSold: checked === true })}
                  />
                  <Label htmlFor="edit-showroom-sold" className="font-normal">Mark as sold on website (shows a SOLD banner across the main photo)</Label>
                </div>
                {vehicle.showroomRemoveAt && (
                  <p className="text-xs text-amber-600">
                    Scheduled to be removed from the website on {formatDate(vehicle.showroomRemoveAt.slice(0, 10))}.
                  </p>
                )}
              </div>
              )}
              <div className="space-y-2 col-span-2">
                <Label>Select Saved Seller</Label>
                <Select value={selectedSellerId} onValueChange={handleSellerSelect}>
                  <SelectTrigger><SelectValue placeholder="Choose a saved seller or enter a one-off" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Enter new details (one-off seller)</SelectItem>
                    {sellers.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-slate-500">Pick a saved seller to auto-fill the details below, or enter a one-off seller manually.</p>
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Seller Name *</Label>
                <Input required value={editData.sellerName} onChange={e => setEditData({...editData, sellerName: e.target.value})} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Seller Address</Label>
                <Textarea value={editData.sellerAddress} onChange={e => setEditData({...editData, sellerAddress: e.target.value})} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Notes</Label>
                <Textarea value={editData.purchaseNotes} onChange={e => setEditData({...editData, purchaseNotes: e.target.value})} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editSaleDialogOpen} onOpenChange={setEditSaleDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Sale Details</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSaleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Sale Date *</Label>
                <Input type="date" required value={editSaleData.saleDate} onChange={e => setEditSaleData({...editSaleData, saleDate: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Invoice Number *</Label>
                <Input required readOnly value={editSaleData.salesInvoiceNumber} className="bg-muted" />
                <p className="text-xs text-muted-foreground">Auto-generated.</p>
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Buyer Name *</Label>
                <Input required value={editSaleData.buyerName} onChange={e => setEditSaleData({...editSaleData, buyerName: e.target.value})} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Buyer Address *</Label>
                <Textarea required value={editSaleData.buyerAddress} onChange={e => setEditSaleData({...editSaleData, buyerAddress: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Buyer Email</Label>
                <Input type="email" value={editSaleData.buyerEmail} onChange={e => setEditSaleData({...editSaleData, buyerEmail: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Buyer Telephone</Label>
                <Input type="tel" value={editSaleData.buyerPhone} onChange={e => setEditSaleData({...editSaleData, buyerPhone: e.target.value})} />
              </div>
              <div className="col-span-2 space-y-3 rounded-md border border-indigo-200 bg-indigo-50/50 p-3">
                <p className="text-sm font-medium text-indigo-900">Finance Company (optional)</p>
                <div className="space-y-2">
                  <Label>Choose a saved finance company</Label>
                  <Select
                    value={selectedEditFinanceCompanyId}
                    onValueChange={(value) => {
                      setSelectedEditFinanceCompanyId(value);
                      if (value === "manual") {
                        setEditSaleData(prev => ({ ...prev, financeCompanyName: "", financeCompanyAddress: "", financeCompanyEmail: "" }));
                      } else {
                        const fc = financeCompanies.find(c => String(c.id) === value);
                        if (fc) {
                          setEditSaleData(prev => ({
                            ...prev,
                            financeCompanyName: fc.name ?? "",
                            financeCompanyAddress: fc.address ?? "",
                            financeCompanyEmail: fc.email ?? "",
                          }));
                        }
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a finance company" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Enter details manually</SelectItem>
                      {financeCompanies.map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Leave blank for a non-finance sale. Selecting a saved company fills the fields below, which you can still edit.</p>
                </div>
                <div className="space-y-2">
                  <Label>Finance Company Name</Label>
                  <Input value={editSaleData.financeCompanyName} onChange={e => { setEditSaleData({...editSaleData, financeCompanyName: e.target.value}); setSelectedEditFinanceCompanyId("manual"); }} />
                </div>
                <div className="space-y-2">
                  <Label>Finance Company Address</Label>
                  <Textarea value={editSaleData.financeCompanyAddress} onChange={e => { setEditSaleData({...editSaleData, financeCompanyAddress: e.target.value}); setSelectedEditFinanceCompanyId("manual"); }} />
                </div>
                <div className="space-y-2">
                  <Label>Finance Company Email</Label>
                  <Input type="email" value={editSaleData.financeCompanyEmail} onChange={e => { setEditSaleData({...editSaleData, financeCompanyEmail: e.target.value}); setSelectedEditFinanceCompanyId("manual"); }} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{vehicle.vatQualifying ? "Sale Price (Net £) *" : "Sale Price (£) *"}</Label>
                <Input type="number" step="0.01" required value={editSaleData.salePrice} onChange={e => setEditSaleData({...editSaleData, salePrice: e.target.value})} />
              </div>
              {vehicle.vatQualifying && (
                <div className="space-y-2">
                  <Label>Sale VAT (£)</Label>
                  <Input type="number" step="0.01" readOnly value={editSaleData.saleVat} />
                  <p className="text-xs text-slate-500">Calculated automatically at the {settings?.vatRate ? `${settings.vatRate}%` : "settings"} VAT rate on the net sale price.</p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Part Exchange Price Paid (£)</Label>
                <Input type="number" step="0.01" value={editSaleData.partExchangeAllowance} onChange={e => setEditSaleData({...editSaleData, partExchangeAllowance: e.target.value})} />
              </div>
              <div className="col-span-2 grid grid-cols-3 gap-4 rounded-md border border-slate-200 p-3">
                <p className="col-span-3 text-sm text-slate-500">Part exchange vehicle details — make, model and registration are required when a part exchange price is entered, and the vehicle is added to your stock book.</p>
                <div className="space-y-2">
                  <Label>PX Make{Number(editSaleData.partExchangeAllowance) > 0 ? " *" : ""}</Label>
                  <Input value={editSaleData.partExchangeMake} onChange={e => setEditSaleData({...editSaleData, partExchangeMake: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>PX Model{Number(editSaleData.partExchangeAllowance) > 0 ? " *" : ""}</Label>
                  <Input value={editSaleData.partExchangeModel} onChange={e => setEditSaleData({...editSaleData, partExchangeModel: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>PX Registration{Number(editSaleData.partExchangeAllowance) > 0 ? " *" : ""}</Label>
                  <RegistrationLookup
                    value={editSaleData.partExchangeRegistration}
                    active={editSaleDialogOpen}
                    partExchange
                    required={Number(editSaleData.partExchangeAllowance) > 0}
                    onChange={(partExchangeRegistration) => setEditSaleData({ ...editSaleData, partExchangeRegistration })}
                    fields={{ make: editSaleData.partExchangeMake, model: editSaleData.partExchangeModel }}
                    onFill={(values) => setEditSaleData((current) => ({ ...current, ...mapRegistrationLookupToPartExchange(values) }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>PX Mileage</Label>
                  <Input type="number" min="0" value={editSaleData.partExchangeMileage} onChange={e => setEditSaleData({...editSaleData, partExchangeMileage: e.target.value})} />
                </div>
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Invoice Note</Label>
                <p className="text-xs text-slate-500">If entered, this text appears on the invoice underneath the vehicle details.</p>
                <Textarea value={editSaleData.invoiceNotes} onChange={e => setEditSaleData({...editSaleData, invoiceNotes: e.target.value})} />
              </div>
              <div className="space-y-2 col-span-2">
                <div className="flex items-center justify-between">
                  <Label>Invoice Extras</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditSaleData({...editSaleData, extras: [...editSaleData.extras, { description: "", amount: "", vatable: false, vat: "", onFinanceInvoice: false }]})}
                  >
                    Add Extra
                  </Button>
                </div>
                <p className="text-sm text-slate-500">
                  Optional additional charges added to the invoice (e.g. warranty, admin fee, delivery). Tick VAT to charge it — the VAT is calculated automatically at your {vatRatePct ? `${vatRatePct}%` : "Settings"} VAT rate.
                  {editSaleData.financeCompanyName.trim() !== ""
                    ? " For each extra, tick \"On finance invoice\" to add it to the finance company's invoice; leave it unticked to bill it on a separate extras invoice to the customer."
                    : " These are billed on a separate standard VAT invoice (the car invoice number with an \"A\" suffix), not on the car sales invoice."}
                </p>
                {!vatRatePct && (
                  <p className="text-sm text-amber-600">Set your VAT rate in Settings to charge VAT on extras.</p>
                )}
                {editSaleData.extras.map((extra, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <Input
                      placeholder="Description"
                      value={extra.description}
                      onChange={e => setEditSaleData({...editSaleData, extras: editSaleData.extras.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x)})}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Amount (£)"
                      value={extra.amount}
                      onChange={e => {
                        const amount = e.target.value;
                        setEditSaleData({...editSaleData, extras: editSaleData.extras.map((x, idx) => idx === i ? { ...x, amount, vat: x.vatable ? String(computeExtraVat(amount, true)) : x.vat } : x)});
                      }}
                      className="w-32"
                    />
                    <div className="flex h-10 w-36 items-center gap-2 shrink-0">
                      <Checkbox
                        id={`edit-extra-vat-${i}`}
                        checked={extra.vatable}
                        onCheckedChange={(checked) => {
                          const vatable = checked === true;
                          setEditSaleData({...editSaleData, extras: editSaleData.extras.map((x, idx) => idx === i ? { ...x, vatable, vat: vatable ? String(computeExtraVat(x.amount, true)) : "" } : x)});
                        }}
                      />
                      <Label htmlFor={`edit-extra-vat-${i}`} className="font-normal whitespace-nowrap text-sm">
                        VAT{extra.vatable && extra.vat ? ` £${Number(extra.vat).toFixed(2)}` : ""}
                      </Label>
                    </div>
                    {editSaleData.financeCompanyName.trim() !== "" && (
                      <div className="flex h-10 w-44 items-center gap-2 shrink-0">
                        <Checkbox
                          id={`edit-extra-fin-${i}`}
                          checked={extra.onFinanceInvoice}
                          onCheckedChange={(checked) => setEditSaleData({...editSaleData, extras: editSaleData.extras.map((x, idx) => idx === i ? { ...x, onFinanceInvoice: checked === true } : x)})}
                        />
                        <Label htmlFor={`edit-extra-fin-${i}`} className="font-normal whitespace-nowrap text-sm">
                          On finance invoice
                        </Label>
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => setEditSaleData({...editSaleData, extras: editSaleData.extras.filter((_, idx) => idx !== i)})}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Sale Notes</Label>
                <Textarea value={editSaleData.saleNotes} onChange={e => setEditSaleData({...editSaleData, saleNotes: e.target.value})} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditSaleDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSavingSale}>
                {isSavingSale && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Sale Details
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="vehicle" className="w-full">
        <TabsList>
          <TabsTrigger value="vehicle">Vehicle</TabsTrigger>
          <TabsTrigger value="info">Details</TabsTrigger>
          {(vehicle.status === 'sold' || (vehicle.holdingDepositAmount != null && vehicle.holdingDepositAmount > 0)) && <TabsTrigger value="payments">Payments</TabsTrigger>}
        </TabsList>

        <TabsContent value="vehicle">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <CardTitle>Vehicle Data</CardTitle>
                <span className="text-sm text-slate-500">Stock No: <span className="font-medium text-slate-900">{vehicle.stockNumber}</span></span>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-slate-500">Registration:</span> <span className="font-medium">{vehicle.registrationNumber}</span></div>
              <div><span className="text-slate-500">VIN:</span> <span className="font-medium">{vehicle.vin || '-'}</span></div>
              <div><span className="text-slate-500">Make:</span> <span className="font-medium">{vehicle.make}</span></div>
              <div><span className="text-slate-500">Model:</span> <span className="font-medium">{vehicle.model}</span></div>
              <div className="col-span-2"><span className="text-slate-500">Description:</span> <span className="font-medium whitespace-pre-wrap">{vehicle.description || '-'}</span></div>
              <div><span className="text-slate-500">Mileage:</span> <span className="font-medium">{vehicle.mileageAtPurchase || '-'}</span></div>
              <div><span className="text-slate-500">Colour:</span> <span className="font-medium">{vehicle.colour || '-'}</span></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="info">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {vehicle.status === 'sold' && (
          <Card className="bg-slate-900 text-white md:col-span-3 order-1">
            <CardHeader>
              <CardTitle className="text-white">{vehicle.vatQualifying ? "VAT Summary (Standard-rated)" : "Margin Summary"}</CardTitle>
            </CardHeader>
            {vehicle.vatQualifying ? (
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-slate-400">Purchase Price (Net)</span>
                  <span>{formatCurrency(vehicle.totalPurchaseCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Purchase VAT</span>
                  <span>{vehicle.purchaseVat != null ? formatCurrency(vehicle.purchaseVat) : "—"}</span>
                </div>
                <div className="h-px bg-slate-800 my-2" />
                <div className="flex justify-between">
                  <span className="text-slate-400">Sale Price (Net)</span>
                  <span>{formatCurrency(vehicle.salePrice)}</span>
                </div>
                <div className="flex justify-between text-red-400 font-bold text-lg">
                  <span>Sale VAT</span>
                  <span>{vehicle.saleVat != null ? formatCurrency(vehicle.saleVat) : "—"}</span>
                </div>
                <p className="text-xs text-slate-500">Standard-rated vehicle — VAT is charged on the full sale price; the margin scheme does not apply.</p>
              </CardContent>
            ) : (
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-slate-400">Purchase Price</span>
                  <span>{formatCurrency(vehicle.totalPurchaseCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Sale Price</span>
                  <span>{formatCurrency(vehicle.salePrice)}</span>
                </div>
                <div className="h-px bg-slate-800 my-2" />
                <div className="flex justify-between font-medium">
                  <span className="text-slate-300">Gross Margin</span>
                  <span>{formatCurrency(vehicle.margin)}</span>
                </div>
                <div className="flex justify-between text-red-400 font-bold text-lg">
                  <span>VAT Due</span>
                  <span>{formatCurrency(vehicle.vatDue)}</span>
                </div>
                <div className="h-px bg-slate-800 my-2" />
                <div className="flex justify-between font-bold text-green-400">
                  <span>Net Margin</span>
                  <span>{formatCurrency(vehicle.netMargin)}</span>
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {vehicle.status === 'reserved' && (
          <Card className="border-amber-300">
            <CardHeader>
              <CardTitle>Holding Deposit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Reference</span>
                <span className="font-medium">{vehicle.holdingDepositReference ?? "—"}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Date</span>
                <span className="font-medium">{vehicle.holdingDepositDate ? formatDate(vehicle.holdingDepositDate) : "—"}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Deposit Paid</span>
                <span className="font-medium">{formatCurrency(vehicle.holdingDepositAmount)}</span>
              </div>
              {vehicle.holdingDepositPaymentMethod && (
                <div className="flex justify-between border-b pb-2">
                  <span className="text-slate-500">Payment Method</span>
                  <span className="font-medium">{vehicle.holdingDepositPaymentMethod}</span>
                </div>
              )}
              <div className="pt-2">
                <span className="text-slate-500 block mb-1">Reserved For</span>
                <span className="font-medium block">{vehicle.buyerName ?? "—"}</span>
                <span className="text-slate-500 whitespace-pre-wrap">{vehicle.buyerAddress}</span>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className={`order-3 ${vehicle.status === 'reserved' ? 'md:col-span-2' : 'md:col-span-3'}`}>
          <CardHeader>
            <CardTitle>Purchase Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">Date</span>
              <span className="font-medium">{formatDate(vehicle.purchaseDate)}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">{vehicle.vatQualifying ? "Price (Net)" : "Price"}</span>
              <span className="font-medium">{formatCurrency(vehicle.purchasePrice)}</span>
            </div>
            {vehicle.vatQualifying && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Purchase VAT</span>
                <span className="font-medium">{vehicle.purchaseVat != null ? formatCurrency(vehicle.purchaseVat) : "—"}</span>
              </div>
            )}
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">Type</span>
              <span className="font-medium capitalize">{vehicle.purchaseType.replace('_', ' ')}</span>
            </div>
            {vehicle.purchaseType === 'auction' && (
              <>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-slate-500">Auction Costs (No VAT)</span>
                  <span className="font-medium">{vehicle.auctionCostNoVat != null ? formatCurrency(vehicle.auctionCostNoVat) : '-'}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-slate-500">Auction Costs (With VAT)</span>
                  <span className="font-medium">{vehicle.auctionCostWithVat != null ? formatCurrency(vehicle.auctionCostWithVat) : '-'}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-slate-500">Total Purchase Cost (inc. auction costs no VAT)</span>
                  <span className="font-medium">{formatCurrency(vehicle.totalPurchaseCost)}</span>
                </div>
              </>
            )}
            <div className="pt-2">
              <span className="text-slate-500 block mb-1">Seller</span>
              <span className="font-medium block">{vehicle.sellerName}</span>
              <span className="text-slate-500 whitespace-pre-wrap">{vehicle.sellerAddress}</span>
            </div>
          </CardContent>
        </Card>

        {vehicle.status === 'sold' && (
          <Card className="md:col-span-3 order-2">
            <CardHeader>
              <CardTitle>Sale Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Date</span>
                <span className="font-medium">{formatDate(vehicle.saleDate)}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Invoice</span>
                <span className="font-medium">{vehicle.salesInvoiceNumber}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Make</span>
                <span className="font-medium">{vehicle.make}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Model</span>
                <span className="font-medium">{vehicle.model}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Registration</span>
                <span className="font-medium">{vehicle.registrationNumber}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">{vehicle.vatQualifying ? "Price (Net)" : "Price"}</span>
                <span className="font-medium">{formatCurrency(vehicle.salePrice)}</span>
              </div>
              {vehicle.vatQualifying && (
                <div className="flex justify-between border-b pb-2">
                  <span className="text-slate-500">Sale VAT</span>
                  <span className="font-medium">{vehicle.saleVat != null ? formatCurrency(vehicle.saleVat) : "—"}</span>
                </div>
              )}
              {vehicle.partExchangeAllowance != null && (
                <div className="flex justify-between border-b pb-2">
                  <span className="text-slate-500">Part Exchange Price Paid</span>
                  <span className="font-medium">{formatCurrency(vehicle.partExchangeAllowance)}</span>
                </div>
              )}
              {vehicle.partExchangeMake && (
                <div className="flex justify-between border-b pb-2">
                  <span className="text-slate-500">PX Make</span>
                  <span className="font-medium">{vehicle.partExchangeMake}</span>
                </div>
              )}
              {vehicle.partExchangeModel && (
                <div className="flex justify-between border-b pb-2">
                  <span className="text-slate-500">PX Model</span>
                  <span className="font-medium">{vehicle.partExchangeModel}</span>
                </div>
              )}
              {vehicle.partExchangeRegistration && (
                <div className="flex justify-between border-b pb-2">
                  <span className="text-slate-500">PX Registration</span>
                  <span className="font-medium">{vehicle.partExchangeRegistration}</span>
                </div>
              )}
              {vehicle.partExchangeMileage != null && (
                <div className="flex justify-between border-b pb-2">
                  <span className="text-slate-500">PX Mileage</span>
                  <span className="font-medium">{vehicle.partExchangeMileage.toLocaleString("en-GB")}</span>
                </div>
              )}
              <div className="pt-2">
                <span className="text-slate-500 block mb-1">Buyer</span>
                <span className="font-medium block">{vehicle.buyerName}</span>
                <span className="text-slate-500 whitespace-pre-wrap">{vehicle.buyerAddress}</span>
                {vehicle.buyerEmail && <span className="text-slate-500 block mt-1">{vehicle.buyerEmail}</span>}
                {vehicle.buyerPhone && <span className="text-slate-500 block">{vehicle.buyerPhone}</span>}
              </div>
            </CardContent>
          </Card>
        )}
          </div>
        </TabsContent>

        {(vehicle.status === 'sold' || (vehicle.holdingDepositAmount != null && vehicle.holdingDepositAmount > 0)) && (
          <TabsContent value="payments">
            {vehicle.status === 'reserved' && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-amber-600" />
                    Holding Deposit
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      A holding deposit of {formatCurrency(vehicle.holdingDepositAmount ?? 0)} was taken on {vehicle.holdingDepositDate ? formatDate(vehicle.holdingDepositDate) : "—"}, reserving this vehicle. The buyer details and deposit carry through to Record Sale.
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-slate-500 block mb-1">Reference</span>
                        <span className="font-medium">{vehicle.holdingDepositReference || "—"}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block mb-1">Amount</span>
                        <span className="font-medium">{formatCurrency(vehicle.holdingDepositAmount ?? 0)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block mb-1">Date</span>
                        <span className="font-medium">{vehicle.holdingDepositDate ? formatDate(vehicle.holdingDepositDate) : "—"}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500 block mb-1">Buyer</span>
                        <span className="font-medium block">{vehicle.buyerName}</span>
                        <span className="text-slate-500 whitespace-pre-wrap">{vehicle.buyerAddress}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={openEditDeposit}>
                        <Edit className="h-4 w-4 mr-2" />
                        Edit Deposit
                      </Button>
                      <Button variant="outline" onClick={downloadHoldingDepositReceipt}>
                        <FileText className="h-4 w-4 mr-2" />
                        Download Deposit Receipt
                      </Button>
                      <Dialog open={editDepositOpen} onOpenChange={setEditDepositOpen}>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Edit holding deposit</DialogTitle>
                          </DialogHeader>
                          <form onSubmit={handleEditDeposit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label>Deposit Amount (£) *</Label>
                                <Input type="number" step="0.01" min="0" required value={editDepositData.holdingDepositAmount} onChange={e => setEditDepositData({...editDepositData, holdingDepositAmount: e.target.value})} />
                              </div>
                              <div className="space-y-2">
                                <Label>Deposit Date *</Label>
                                <Input type="date" required value={editDepositData.holdingDepositDate} onChange={e => setEditDepositData({...editDepositData, holdingDepositDate: e.target.value})} />
                              </div>
                              <div className="space-y-2 col-span-2">
                                <Label>Payment Method</Label>
                                <Select value={editDepositData.holdingDepositPaymentMethod} onValueChange={value => setEditDepositData({...editDepositData, holdingDepositPaymentMethod: value})}>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select a payment method" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {HOLDING_DEPOSIT_PAYMENT_METHODS.map(m => (
                                      <SelectItem key={m} value={m}>{m}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2 col-span-2">
                                <Label>Buyer Name *</Label>
                                <Input required value={editDepositData.buyerName} onChange={e => setEditDepositData({...editDepositData, buyerName: e.target.value})} />
                              </div>
                              <div className="space-y-2 col-span-2">
                                <Label>Buyer Address *</Label>
                                <Textarea required value={editDepositData.buyerAddress} onChange={e => setEditDepositData({...editDepositData, buyerAddress: e.target.value})} />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button type="button" variant="outline" onClick={() => setEditDepositOpen(false)} disabled={isEditingDeposit}>Cancel</Button>
                              <Button type="submit" disabled={isEditingDeposit}>
                                {isEditingDeposit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Changes
                              </Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                      <Dialog open={refundDialogOpen} onOpenChange={setRefundDialogOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" className="border-red-400 text-red-600 hover:text-red-700">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Refund Deposit
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Refund holding deposit?</DialogTitle>
                          </DialogHeader>
                          <p className="text-sm text-slate-500">
                            This returns the vehicle to stock and clears the holding deposit and buyer details. The buyer details will no longer carry through to Record Sale. This cannot be undone.
                          </p>
                          <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setRefundDialogOpen(false)} disabled={isRefunding}>Cancel</Button>
                            <Button type="button" variant="destructive" onClick={handleRefundDeposit} disabled={isRefunding}>
                              {isRefunding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              Refund &amp; Return to Stock
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {vehicle.salePrice != null && (
              <Card className="mb-6">
                <CardHeader>
                  <div className="flex items-center justify-between gap-4">
                    <CardTitle>Outstanding Amount</CardTitle>
                    <span className="text-lg font-semibold text-slate-900">{formatCurrency(outstandingAmount)}</span>
                  </div>
                </CardHeader>
              </Card>
            )}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <CardTitle>Payments</CardTitle>
                  {editingPayments ? (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={cancelEditingPayments} disabled={isSavingPayments}>Cancel</Button>
                      <Button size="sm" onClick={handleSavePayments} disabled={isSavingPayments}>
                        {isSavingPayments && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save
                      </Button>
                    </div>
                  ) : (
                    vehicle.status === 'sold' && (
                      <Button variant="outline" size="sm" onClick={startEditingPayments}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit Payments
                      </Button>
                    )
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {editingPayments ? (
                  <div className="space-y-4">
                    {vehicleInvoice?.balancePayable != null && (
                      <p className="text-sm text-slate-500">Invoice Total: <span className="font-medium text-slate-900">{formatCurrency(vehicleInvoice.balancePayable)}</span></p>
                    )}
                    {paymentsDraft.length > 0 ? (
                      <PaymentSchedule rows={paymentsDraft} onChange={setPaymentsDraft} onRemove={removePaymentRow} showLabel={false} showTotal />
                    ) : (
                      <p className="text-sm text-slate-500">No payments yet. Add a payment to build the schedule.</p>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={addPaymentRow}>Add Payment</Button>
                  </div>
                ) : (() => {
                  const displayRows = scheduleRows;
                  return (
                  <>
                    {vehicle.numberOfPayments != null && (
                      <p className="mb-3 text-sm text-slate-500">Number of Payments: <span className="font-medium text-slate-900">{vehicle.numberOfPayments}</span></p>
                    )}
                    {displayRows.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">#</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Method</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {displayRows.map((p, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-slate-500">{i + 1}</TableCell>
                              <TableCell>{p.date ? formatDate(p.date) : "—"}</TableCell>
                              <TableCell>{p.type || "—"}</TableCell>
                              <TableCell>{p.paymentMethod || "—"}</TableCell>
                              <TableCell className="text-right">{p.amount != null ? formatCurrency(p.type === "Payment to Customer" ? -p.amount : p.amount) : "—"}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="border-t-2 font-medium">
                            <TableCell></TableCell>
                            <TableCell className="text-slate-500">Total</TableCell>
                            <TableCell></TableCell>
                            <TableCell></TableCell>
                            <TableCell className="text-right">{formatCurrency(paymentTotal(displayRows))}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-slate-500">No payment schedule was recorded for this sale.</p>
                    )}
                  </>
                  );
                })()}
              </CardContent>
            </Card>
            {vehicle.salePrice != null && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Invoices</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Car Sale</span>
                    <span className="font-medium text-slate-900">{formatCurrency(vehicle.salePrice)}</span>
                  </div>
                  {extrasTotal > 0 && (
                    <div className="mt-1 flex items-center justify-between text-sm">
                      <span className="text-slate-500">Extras</span>
                      <span className="font-medium text-slate-900">{formatCurrency(extrasTotal)}</span>
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm font-semibold">
                    <span className="text-slate-900">Total</span>
                    <span className="text-slate-900">{formatCurrency(vehicle.salePrice + extrasTotal)}</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

      </Tabs>
    </div>
  );
}