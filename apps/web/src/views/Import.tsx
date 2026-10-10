import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  useImportVehicles,
  getListVehiclesQueryKey,
  getGetDashboardSummaryQueryKey,
  customFetch,
  ApiError,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import Papa from "papaparse";
import { Upload, Loader2, AlertCircle, CheckCircle2, Download, Globe, Car, RefreshCw, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface CazooPreviewRow {
  listingId: string;
  url: string;
  make: string;
  model: string;
  year: number | null;
  derivative: string | null;
  title: string;
  price: number | null;
  mileage: number | null;
  fuel: string | null;
  gearbox: string | null;
  colour: string | null;
  vrm: string | null;
  marketingDescription: string | null;
  photoPrefix: string | null;
  photoCount: number;
  thumbnailUrl: string | null;
  duplicate: boolean;
  duplicateReason: string | null;
}

type CazooImportOutcome = {
  listingId: string;
  title: string;
  status: "imported" | "failed";
  message?: string;
  photosImported?: number;
};

function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const data = err.data as { error?: string; message?: string } | null;
    if (data?.message) return data.message;
    if (data?.error) return data.error;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

function formatMiles(n: number | null): string {
  return n == null ? "—" : `${n.toLocaleString("en-GB")} miles`;
}

function formatPrice(n: number | null): string {
  return n == null ? "—" : `£${n.toLocaleString("en-GB")}`;
}

interface CazooHealthResult {
  status: "ok" | "failing" | "fetch_error" | "not_configured" | "pending";
  checkedAt: string | null;
  url: string | null;
  vehicleCount: number;
  problems: string[];
  message: string;
}

// Warning banner fed by the daily server-side check of the dealer's live Cazoo
// page. Only shown when something is wrong — quiet when healthy.
function CazooHealthBanner() {
  const { data } = useQuery({
    queryKey: ["cazoo-health"],
    queryFn: () => customFetch<CazooHealthResult>("/api/cazoo/health"),
    staleTime: 5 * 60 * 1000,
  });

  if (!data || data.status === "ok" || data.status === "not_configured" || data.status === "pending") {
    return null;
  }

  const checkedLabel = data.checkedAt
    ? new Date(data.checkedAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })
    : null;

  if (data.status === "failing") {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Cazoo imports may be broken</AlertTitle>
        <AlertDescription>
          <p>{data.message}</p>
          {data.problems.length > 0 && (
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              {data.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {checkedLabel && <p className="mt-1 text-xs">Last checked {checkedLabel}.</p>}
        </AlertDescription>
      </Alert>
    );
  }

  // fetch_error — inconclusive, softer amber notice.
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-900 [&>svg]:text-amber-600">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Couldn't check Cazoo today</AlertTitle>
      <AlertDescription>
        <p>{data.message}</p>
        {checkedLabel && <p className="mt-1 text-xs">Last checked {checkedLabel}.</p>}
      </AlertDescription>
    </Alert>
  );
}

function CazooImportCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [rows, setRows] = useState<CazooPreviewRow[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<CazooImportOutcome[] | null>(null);

  const handlePreview = async () => {
    if (!url.trim()) return;
    setIsFetching(true);
    setRows(null);
    setOutcomes(null);
    try {
      const res = await customFetch<{ vehicles: CazooPreviewRow[] }>("/api/cazoo/preview", {
        method: "POST",
        body: JSON.stringify({ url: url.trim() }),
      });
      setRows(res.vehicles);
      setTicked(new Set(res.vehicles.filter((v) => !v.duplicate).map((v) => v.listingId)));
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't read that page", description: apiErrorMessage(err) });
    } finally {
      setIsFetching(false);
    }
  };

  const toggle = (id: string) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = async () => {
    if (!rows) return;
    const selected = rows.filter((r) => ticked.has(r.listingId));
    if (selected.length === 0) return;
    setImporting(true);
    setOutcomes(null);
    setProgress({ done: 0, total: selected.length });
    const results: CazooImportOutcome[] = [];
    for (const row of selected) {
      try {
        const res = await customFetch<{ photosImported: number }>("/api/cazoo/import", {
          method: "POST",
          body: JSON.stringify({
            vehicle: {
              listingId: row.listingId,
              url: row.url,
              make: row.make,
              model: row.model,
              year: row.year,
              derivative: row.derivative,
              title: row.title,
              price: row.price,
              mileage: row.mileage,
              fuel: row.fuel,
              gearbox: row.gearbox,
              colour: row.colour,
              vrm: row.vrm,
              marketingDescription: row.marketingDescription,
              photoPrefix: row.photoPrefix,
              photoCount: row.photoCount,
            },
          }),
        });
        results.push({
          listingId: row.listingId,
          title: row.title,
          status: "imported",
          photosImported: res.photosImported,
        });
      } catch (err) {
        results.push({
          listingId: row.listingId,
          title: row.title,
          status: "failed",
          message: apiErrorMessage(err),
        });
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setImporting(false);
    setProgress(null);
    setOutcomes(results);
    const importedCount = results.filter((r) => r.status === "imported").length;
    if (importedCount > 0) {
      queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      toast({ title: "Import complete", description: `${importedCount} vehicle${importedCount === 1 ? "" : "s"} added to your stock book.` });
    }
  };

  const tickedCount = rows ? rows.filter((r) => ticked.has(r.listingId)).length : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-slate-500" />
          Import from Cazoo
        </CardTitle>
        <CardDescription>
          Paste your Cazoo dealer page link (www.cazoo.co.uk/dealers/…) or a single car listing link
          (www.cazoo.co.uk/cars-for-sale/…). We'll read your listings so you can pick which cars to add,
          copying the photos and details across. Purchase details (price, date, seller) are filled with
          placeholders for you to complete afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CazooHealthBanner />
        <div className="flex gap-2">
          <Input
            placeholder="https://www.cazoo.co.uk/dealers/your-dealership-12345/"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handlePreview();
            }}
            disabled={isFetching || importing}
          />
          <Button onClick={handlePreview} disabled={!url.trim() || isFetching || importing} className="shrink-0">
            {isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isFetching ? "Reading page…" : "Fetch listings"}
          </Button>
        </div>

        {isFetching && (
          <p className="text-sm text-slate-500">
            Reading your Cazoo page — this can take up to a minute.
          </p>
        )}

        {rows && rows.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-600">
                Found {rows.length} car{rows.length === 1 ? "" : "s"}. Untick any you don't want to import.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTicked(new Set(rows.map((r) => r.listingId)))}
                  disabled={importing}
                >
                  Select all
                </Button>
                <Button variant="outline" size="sm" onClick={() => setTicked(new Set())} disabled={importing}>
                  Select none
                </Button>
              </div>
            </div>

            <div className="border rounded-lg divide-y max-h-[28rem] overflow-y-auto">
              {rows.map((row) => (
                <label
                  key={row.listingId}
                  className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-50 ${ticked.has(row.listingId) ? "" : "opacity-60"}`}
                >
                  <Checkbox
                    checked={ticked.has(row.listingId)}
                    onCheckedChange={() => toggle(row.listingId)}
                    disabled={importing}
                  />
                  {row.thumbnailUrl ? (
                    <img
                      src={row.thumbnailUrl}
                      alt={row.title}
                      className="h-14 w-20 object-cover rounded bg-slate-100 shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-14 w-20 rounded bg-slate-100 flex items-center justify-center shrink-0">
                      <Car className="h-6 w-6 text-slate-400" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 truncate">{row.title}</p>
                    <p className="text-sm text-slate-500 truncate">
                      {[formatMiles(row.mileage), row.fuel, row.gearbox, row.vrm].filter(Boolean).join(" · ")}
                    </p>
                    {row.duplicate && (
                      <p className="text-xs text-amber-700 mt-0.5 truncate" title={row.duplicateReason ?? undefined}>
                        {row.duplicateReason}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold text-slate-900">{formatPrice(row.price)}</p>
                    {row.duplicate && (
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 mt-1">
                        Possible duplicate
                      </Badge>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                {tickedCount} of {rows.length} selected
              </p>
              <Button onClick={handleImport} disabled={tickedCount === 0 || importing}>
                {importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {importing && progress
                  ? `Importing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                  : `Import ${tickedCount} selected`}
              </Button>
            </div>

            {importing && (
              <p className="text-sm text-slate-500">
                Copying photos for each car — please keep this page open.
              </p>
            )}
          </div>
        )}

        {outcomes && (
          <div className="space-y-3">
            {outcomes.some((o) => o.status === "imported") && (
              <Alert variant="default" className="bg-green-50 border-green-200">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle className="text-green-800">
                  Imported {outcomes.filter((o) => o.status === "imported").length} vehicle
                  {outcomes.filter((o) => o.status === "imported").length === 1 ? "" : "s"}
                </AlertTitle>
                <AlertDescription className="text-green-700">
                  Each car has been added as in stock with its photos, but NOT published to your
                  website. Open each vehicle to fill in the real purchase price, date, seller
                  {outcomes.some((o) => o.status === "imported") ? " and registration where shown as CAZOO-…" : ""}, then publish it when it&apos;s ready.
                </AlertDescription>
              </Alert>
            )}
            {outcomes.some((o) => o.status === "failed") && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Some cars couldn't be imported</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 mt-2 space-y-1">
                    {outcomes
                      .filter((o) => o.status === "failed")
                      .map((o) => (
                        <li key={o.listingId}>
                          {o.title}: {o.message}
                        </li>
                      ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end">
              <Button variant="outline" onClick={handlePreview} disabled={!url.trim() || isFetching || importing}>
                {isFetching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {isFetching ? "Refreshing…" : "Refresh listings"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const importVehicles = useImportVehicles();

  const handleDownloadTemplate = () => {
    const csv = Papa.unparse({
      fields: [
        "Registration",
        "Make",
        "Model",
        "Mileage",
        "Purchase Date",
        "Purchase Type",
        "Cost",
        "VAT Qualifying",
        "Purchase VAT",
        "Auction Costs (No VAT)",
        "Auction Costs (With VAT)",
        "Purchase Invoice Ref",
        "Purchase Document Reference",
        "Seller",
        "Seller Address",
        "Notes",
      ],
      data: [
        [
          "AB12 CDE",
          "Ford",
          "Focus",
          "45000",
          "2026-01-15",
          "trade",
          "5000",
          "No",
          "",
          "",
          "",
          "PINV-001",
          "DOC-001",
          "Opening Stock",
          "1 High Street, London",
          "Example row — delete before importing",
        ],
        [
          "XY19 ZZZ",
          "BMW",
          "320d",
          "30000",
          "2026-02-01",
          "auction",
          "12000",
          "Yes",
          "2400",
          "150",
          "60",
          "PINV-002",
          "",
          "BCA Auctions",
          "",
          "",
        ],
      ],
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "stock-book-import-template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleProcess = () => {
    if (!file) return;
    setIsImporting(true);
    setResult(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const validTypes = ['private', 'auction', 'trade', 'part_exchange', 'other'];
          const parseNum = (val: any): number | undefined => {
            if (val === undefined || val === null || String(val).trim() === '') return undefined;
            const n = Number(String(val).replace(/[£,\s]/g, ''));
            return Number.isFinite(n) ? n : undefined;
          };
          const parseBool = (val: any): boolean => {
            const s = String(val ?? '').trim().toLowerCase();
            return s === 'yes' || s === 'true' || s === 'y' || s === '1';
          };
          const normalizeType = (val: any): string => {
            const s = String(val ?? '').trim().toLowerCase().replace(/\s+/g, '_');
            return validTypes.includes(s) ? s : 'trade';
          };

          const clientErrors: string[] = [];
          const mappedData: any[] = [];

          (results.data as any[]).forEach((row, idx) => {
            const registrationNumber = String(row['Registration'] || row['Reg'] || '').trim();
            if (!registrationNumber) return;

            const rawCost = row['Cost'] ?? row['Purchase Price'];
            const cost = parseNum(rawCost);
            if (cost === undefined) {
              clientErrors.push(
                `Row ${idx + 1} (${registrationNumber}): missing or invalid Cost — skipped.`,
              );
              return;
            }

            const vehicle: any = {
              registrationNumber,
              make: row['Make'] || 'Unknown',
              model: row['Model'] || 'Unknown',
              purchaseDate: row['Purchase Date'] || new Date().toISOString().split('T')[0],
              purchasePrice: cost,
              sellerName: row['Seller'] || 'Opening Stock',
              purchaseType: normalizeType(row['Purchase Type']),
            };

            const mileage = parseNum(row['Mileage']);
            if (mileage !== undefined) vehicle.mileageAtPurchase = Math.round(mileage);

            const invoiceRef = String(row['Purchase Invoice Ref'] || '').trim();
            if (invoiceRef) vehicle.purchaseInvoiceNumber = invoiceRef;

            const docRef = String(row['Purchase Document Reference'] || '').trim();
            if (docRef) vehicle.purchaseDocumentReference = docRef;

            const sellerAddress = String(row['Seller Address'] || '').trim();
            if (sellerAddress) vehicle.sellerAddress = sellerAddress;

            const notes = String(row['Notes'] || '').trim();
            if (notes) vehicle.purchaseNotes = notes;

            if (parseBool(row['VAT Qualifying'])) {
              vehicle.vatQualifying = true;
              const purchaseVat = parseNum(row['Purchase VAT']);
              if (purchaseVat !== undefined) vehicle.purchaseVat = purchaseVat;
            }

            if (vehicle.purchaseType === 'auction') {
              const acNoVat = parseNum(row['Auction Costs (No VAT)']);
              if (acNoVat !== undefined) vehicle.auctionCostNoVat = acNoVat;
              const acWithVat = parseNum(row['Auction Costs (With VAT)']);
              if (acWithVat !== undefined) vehicle.auctionCostWithVat = acWithVat;
            }

            mappedData.push(vehicle);
          });

          if (mappedData.length === 0) {
            throw new Error(
              clientErrors.length > 0
                ? clientErrors.join(" ")
                : "No valid records found in CSV. Please check columns.",
            );
          }

          const res = await importVehicles.mutateAsync({
            data: { vehicles: mappedData }
          });

          setResult({
            ...res,
            skipped: res.skipped + clientErrors.length,
            errors: [...clientErrors, ...res.errors],
          });
          queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: "Import complete" });
        } catch (err: any) {
          toast({ variant: "destructive", title: "Import failed", description: err.message || err.error });
        } finally {
          setIsImporting(false);
        }
      },
      error: (err) => {
        toast({ variant: "destructive", title: "CSV Parsing Error", description: err.message });
        setIsImporting(false);
      }
    });
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Import Stock</h1>
        <p className="text-slate-500">Bring vehicles into your stock book from Cazoo or a CSV file.</p>
      </div>

      <CazooImportCard />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Upload CSV</CardTitle>
              <CardDescription>
                Required: Registration, Make, Model, Purchase Date (YYYY-MM-DD), Cost. Optional: Mileage, Purchase Type
                (private/auction/trade/part_exchange/other), VAT Qualifying (Yes/No), Purchase VAT, Auction Costs (No VAT),
                Auction Costs (With VAT), Purchase Invoice Ref, Purchase Document Reference, Seller, Seller Address, Notes.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="shrink-0">
              <Download className="mr-2 h-4 w-4" />
              Download template
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-dashed border-slate-200 rounded-lg p-12 text-center hover:bg-slate-50 transition-colors">
            <input 
              type="file" 
              accept=".csv" 
              className="hidden" 
              id="csv-upload"
              onChange={e => setFile(e.target.files?.[0] || null)}
            />
            <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center">
              <Upload className="h-12 w-12 text-slate-400 mb-4" />
              <span className="text-lg font-medium text-slate-900 mb-1">
                {file ? file.name : "Click to select a CSV file"}
              </span>
              <span className="text-sm text-slate-500">
                or drag and drop here
              </span>
            </label>
          </div>

          <div className="flex justify-end">
            <Button disabled={!file || isImporting} onClick={handleProcess}>
              {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Process Import
            </Button>
          </div>

          {result && (
            <div className="mt-8 space-y-4">
              <Alert variant="default" className="bg-green-50 border-green-200">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle className="text-green-800">Import Successful</AlertTitle>
                <AlertDescription className="text-green-700">
                  Successfully imported {result.imported} vehicles.
                  {result.skipped > 0 && ` Skipped ${result.skipped} records.`}
                </AlertDescription>
              </Alert>

              {result.errors?.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Errors during import</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 mt-2 space-y-1">
                      {result.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}