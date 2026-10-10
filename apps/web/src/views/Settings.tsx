import { useState, useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey, type DealerSettingsInputVatQuarter } from "@workspace/api-client-react";
import { ObjectUploader } from "@workspace/object-storage-web";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Upload, Image as ImageIcon, ChevronUp, ChevronDown } from "lucide-react";
import Import from "@/views/Import";
import UsersTab from "@/components/settings/UsersTab";
import {
  defaultShowroomIntro,
  DEFAULT_ABOUT_TITLE,
  DEFAULT_FEATURES,
  DEFAULT_ACCENT,
  DEFAULT_BG,
  DEFAULT_BG_TEXT,
  type ShowroomFeature,
  type ShowroomReview,
} from "@/views/Showroom";

// The showroom home page shows a fixed number of "why buy from us" cards.
const FEATURE_SLOTS = DEFAULT_FEATURES.length;

function emptyFeatures(): ShowroomFeature[] {
  return Array.from({ length: FEATURE_SLOTS }, () => ({ title: "", body: "" }));
}

// Pad/trim saved features to exactly FEATURE_SLOTS editable rows.
function toFeatureSlots(saved: ShowroomFeature[] | null | undefined): ShowroomFeature[] {
  const slots = emptyFeatures();
  (saved ?? []).slice(0, FEATURE_SLOTS).forEach((f, i) => {
    slots[i] = {
      title: f.title ?? "",
      body: f.body ?? "",
      ...(f.iconPath ? { iconPath: f.iconPath } : {}),
    };
  });
  return slots;
}

const VAT_QUARTER_OPTIONS = [
  { value: "stagger_1", label: "Stagger 1 — quarters ending Mar / Jun / Sep / Dec" },
  { value: "stagger_2", label: "Stagger 2 — quarters ending Apr / Jul / Oct / Jan" },
  { value: "stagger_3", label: "Stagger 3 — quarters ending May / Aug / Nov / Feb" },
  { value: "monthly", label: "Monthly returns" },
  { value: "annual", label: "Annual accounting scheme" },
];

const MARGIN_SCHEME_WORDING =
  "Margin Scheme – Second-hand Goods. No VAT is separately charged or reclaimable on this invoice.";

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { getToken } = useAuth();

  const [formData, setFormData] = useState({
    businessName: "",
    address: "",
    vatNumber: "",
    businessType: "Limited Company",
    companyName: "",
    companyNumber: "",
    placeOfRegistration: "England and Wales",
    registeredOfficeAddress: "",
    phone: "",
    email: "",
    website: "",
    bankAccountName: "",
    bankName: "",
    bankSortCode: "",
    bankAccountNumber: "",
    marginSchemeWording: "",
    defaultInvoiceWording: "",
    vatQuarter: "",
    vatRate: "",
    carSalesCode: "",
    vatQualifyingCode: "",
    otherSalesCode: "",
    carPurchasesCode: "",
    stockCode: "",
    auctionCostNoVatCode: "",
    auctionCostVatCode: "",
    financeProvided: false,
    financeFrnNumber: "",
    financeWording: "",
    invoiceAccentColour: "",
    showroomBgColour: "",
    showroomBgTextColour: "",
    showroomEnabled: true,
    showroomHeadline: "",
    showroomIntro: "",
    showroomAboutTitle: "",
    showroomFeatures: emptyFeatures(),
    showroomReviews: [] as ShowroomReview[],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");
  const pendingObjectPath = useRef<string | null>(null);
  const basePath = "";

  useEffect(() => {
    if (settings) {
      setFormData({
        businessName: settings.businessName || "",
        address: settings.address || "",
        vatNumber: settings.vatNumber || "",
        businessType: settings.businessType || "Limited Company",
        companyName: settings.companyName || "",
        companyNumber: settings.companyNumber || "",
        placeOfRegistration: settings.placeOfRegistration || "England and Wales",
        registeredOfficeAddress: settings.registeredOfficeAddress || "",
        phone: settings.phone || "",
        email: settings.email || "",
        website: settings.website || "",
        bankAccountName: settings.bankAccountName || "",
        bankName: settings.bankName || "",
        bankSortCode: settings.bankSortCode || "",
        bankAccountNumber: settings.bankAccountNumber || "",
        marginSchemeWording: settings.marginSchemeWording || "",
        defaultInvoiceWording: settings.defaultInvoiceWording || "",
        vatQuarter: settings.vatQuarter || "",
        vatRate: settings.vatRate || "",
        carSalesCode: settings.carSalesCode || "",
        vatQualifyingCode: settings.vatQualifyingCode || "",
        otherSalesCode: settings.otherSalesCode || "",
        carPurchasesCode: settings.carPurchasesCode || "",
        stockCode: settings.stockCode || "",
        auctionCostNoVatCode: settings.auctionCostNoVatCode || "",
        auctionCostVatCode: settings.auctionCostVatCode || "",
        financeProvided: settings.financeProvided ?? false,
        financeFrnNumber: settings.financeFrnNumber || "",
        financeWording: settings.financeWording || "",
        invoiceAccentColour: settings.invoiceAccentColour || "",
        showroomBgColour: settings.showroomBgColour || "",
        showroomBgTextColour: settings.showroomBgTextColour || "",
        showroomEnabled: settings.showroomEnabled ?? true,
        showroomHeadline: settings.showroomHeadline || "",
        showroomIntro: settings.showroomIntro || "",
        showroomAboutTitle: settings.showroomAboutTitle || "",
        showroomFeatures: toFeatureSlots(settings.showroomFeatures),
        showroomReviews: (settings.showroomReviews ?? []).map((r) => ({
          author: r.author ?? "",
          rating: r.rating ?? 5,
          text: r.text ?? "",
          ...(r.date ? { date: r.date } : {}),
        })),
      });
    }
  }, [settings]);

  // Margin Scheme invoices must carry the standard second-hand-goods footer.
  // Once a VAT number is entered, pre-fill the (editable) margin-scheme wording
  // if the dealer has not already set their own.
  useEffect(() => {
    if (!formData.vatNumber.trim()) return;
    setFormData((prev) =>
      prev.marginSchemeWording.trim()
        ? prev
        : { ...prev, marginSchemeWording: MARGIN_SCHEME_WORDING },
    );
  }, [formData.vatNumber]);

  // Swap a review with its neighbour to let the dealer reorder the list. The
  // saved order is exactly how reviews appear on the public showroom.
  const moveReview = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= formData.showroomReviews.length) return;
    const next = [...formData.showroomReviews];
    [next[i], next[j]] = [next[j], next[i]];
    setFormData({ ...formData, showroomReviews: next });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.businessName.trim()) {
      setActiveTab("profile");
      toast({ variant: "destructive", title: "Business name is required" });
      return;
    }
    if (formData.businessType === "Limited Company") {
      if (
        !formData.companyName.trim() ||
        !formData.companyNumber.trim() ||
        !formData.placeOfRegistration.trim() ||
        !formData.registeredOfficeAddress.trim()
      ) {
        setActiveTab("profile");
        toast({
          variant: "destructive",
          title: "Company details are required",
          description:
            "Company name, company number, place of registration and registered office address are required for a Limited Company.",
        });
        return;
      }
    }
    if (formData.financeProvided) {
      if (!formData.financeFrnNumber.trim() || !formData.financeWording.trim()) {
        setActiveTab("showroom");
        toast({
          variant: "destructive",
          title: "Finance details are required",
          description:
            "An FRN number and finance wording are required when finance is provided.",
        });
        return;
      }
    }
    // A review must carry both a reviewer name and review text (only the date is
    // optional). Reject part-filled rows; fully-empty rows are silently dropped.
    const partialReview = formData.showroomReviews.some((r) => {
      const hasAuthor = r.author.trim() !== "";
      const hasText = r.text.trim() !== "";
      return (hasAuthor || hasText) && !(hasAuthor && hasText);
    });
    if (partialReview) {
      setActiveTab("showroom");
      toast({
        variant: "destructive",
        title: "Reviews need a name and review text",
        description:
          "Each review must have both a reviewer name and review text. Fill in both, or remove the review.",
      });
      return;
    }
    setIsSaving(true);
    try {
      const { vatQuarter, ...rest } = formData;
      const isHex = (v: string) => /^#([0-9a-fA-F]{6})$/.test(v);
      const accent = rest.invoiceAccentColour.trim();
      const bg = rest.showroomBgColour.trim();
      const bgText = rest.showroomBgTextColour.trim();
      const base = {
        ...rest,
        // Only persist a valid hex colour; anything else falls back to the
        // default so a mistyped value can't break the showroom styling.
        invoiceAccentColour: isHex(accent) ? accent : "",
        showroomBgColour: isHex(bg) ? bg : "",
        showroomBgTextColour: isHex(bgText) ? bgText : "",
        // Trim reviews and drop any blank rows so the showroom never renders an
        // empty review card.
        showroomReviews: rest.showroomReviews
          .map((r) => {
            const date = (r.date ?? "").trim();
            return {
              author: r.author.trim(),
              rating: r.rating,
              text: r.text.trim(),
              ...(date ? { date } : {}),
            };
          })
          .filter((r) => r.author || r.text),
      };
      const data = vatQuarter
        ? { ...base, vatQuarter: vatQuarter as DealerSettingsInputVatQuarter }
        : base;
      await updateSettings.mutateAsync({ data });
      queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Settings saved" });
    } catch (err) {
      toast({ variant: "destructive", title: "Error saving settings" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="p-8">Loading settings...</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500">Manage details and settings.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="profile">Business Details</TabsTrigger>
          <TabsTrigger value="codes">Account Codes</TabsTrigger>
          <TabsTrigger value="showroom">Website</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Business Details</CardTitle>
                    <CardDescription>This information appears on your invoices.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Business Name *</Label>
                      <Input required value={formData.businessName} onChange={e => setFormData({...formData, businessName: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>Address</Label>
                      <Textarea value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>Business Type</Label>
                      <Select
                        value={formData.businessType}
                        onValueChange={(value) => setFormData({ ...formData, businessType: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Limited Company">Limited Company</SelectItem>
                          <SelectItem value="Partnership">Partnership</SelectItem>
                          <SelectItem value="Sole Trader">Sole Trader</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {formData.businessType === "Limited Company" && (
                      <>
                        <div className="space-y-2">
                          <Label>Company Name *</Label>
                          <Input required value={formData.companyName} onChange={e => setFormData({...formData, companyName: e.target.value})} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Company Number *</Label>
                            <Input required value={formData.companyNumber} onChange={e => setFormData({...formData, companyNumber: e.target.value})} />
                          </div>
                          <div className="space-y-2">
                            <Label>Place of Registration *</Label>
                            <Input required value={formData.placeOfRegistration} onChange={e => setFormData({...formData, placeOfRegistration: e.target.value})} placeholder="e.g. England and Wales" />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Registered Office Address *</Label>
                          <Textarea required value={formData.registeredOfficeAddress} onChange={e => setFormData({...formData, registeredOfficeAddress: e.target.value})} />
                        </div>
                      </>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Phone</Label>
                        <Input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label>Website</Label>
                        <Input value={formData.website} onChange={e => setFormData({...formData, website: e.target.value})} />
                      </div>
                    </div>
                    <div className="space-y-4 rounded-lg border border-slate-200 p-4">
                      <div>
                        <h3 className="text-sm font-medium text-slate-900">Bank Details</h3>
                        <p className="text-xs text-slate-500">Shown on invoices so customers know where to pay.</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Account Name</Label>
                        <Input value={formData.bankAccountName} onChange={e => setFormData({...formData, bankAccountName: e.target.value})} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Bank Name</Label>
                          <Input value={formData.bankName} onChange={e => setFormData({...formData, bankName: e.target.value})} />
                        </div>
                        <div className="space-y-2">
                          <Label>Sort Code</Label>
                          <Input value={formData.bankSortCode} onChange={e => setFormData({...formData, bankSortCode: e.target.value})} placeholder="00-00-00" />
                        </div>
                        <div className="space-y-2">
                          <Label>Account Number</Label>
                          <Input value={formData.bankAccountNumber} onChange={e => setFormData({...formData, bankAccountNumber: e.target.value})} placeholder="00000000" />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Additional Invoice Footer Wording</Label>
                      <Textarea value={formData.defaultInvoiceWording} onChange={e => setFormData({...formData, defaultInvoiceWording: e.target.value})} />
                      <p className="text-xs text-slate-500">Optional extra wording (e.g. terms or notes) shown below the margin scheme wording on invoices.</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>VAT</CardTitle>
                    <CardDescription>VAT registration and reporting settings.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>VAT Registration Number</Label>
                      <Input value={formData.vatNumber} onChange={e => setFormData({...formData, vatNumber: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>Invoice Footer Wording</Label>
                      <Textarea value={formData.marginSchemeWording} onChange={e => setFormData({...formData, marginSchemeWording: e.target.value})} />
                      <p className="text-xs text-slate-500">Shown on Margin Scheme sales invoices. The standard wording is filled in automatically once a VAT number is entered; edit it if required.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>VAT Quarter</Label>
                      <Select
                        value={formData.vatQuarter}
                        onValueChange={(value) => setFormData({ ...formData, vatQuarter: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select your VAT return period" />
                        </SelectTrigger>
                        <SelectContent>
                          {VAT_QUARTER_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-slate-500">Your HMRC VAT return period (stagger group). Used to group VAT due on reports.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>VAT Rate (%)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="20"
                        value={formData.vatRate}
                        onChange={e => setFormData({...formData, vatRate: e.target.value})}
                      />
                      <p className="text-xs text-slate-500">Standard VAT rate applied to VAT-qualifying vehicles and charges.</p>
                    </div>
                  </CardContent>
                </Card>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </form>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Company Logo</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {settings?.logoPath ? (
                    <img src={`/api/storage${settings.logoPath}`} alt="Logo" className="max-w-full h-auto max-h-32 object-contain" />
                  ) : (
                    <div className="h-32 bg-slate-100 rounded flex items-center justify-center text-slate-400">No logo uploaded</div>
                  )}

                  <ObjectUploader
                    allowedFileTypes={["image/jpeg", "image/png", "image/gif", "image/webp"]}
                    onGetUploadParameters={async (file) => {
                      const token = await getToken();
                      const res = await fetch("/api/storage/uploads/request-url", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        },
                        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
                      });
                      if (!res.ok) {
                        throw new Error(`Failed to start upload (${res.status})`);
                      }
                      const { uploadURL, objectPath } = await res.json();
                      pendingObjectPath.current = objectPath;
                      return { method: "PUT", url: uploadURL, headers: { "Content-Type": file.type } };
                    }}
                    onComplete={async (result) => {
                      const objectPath = pendingObjectPath.current;
                      if (result.successful?.[0] && objectPath) {
                        await updateSettings.mutateAsync({ data: { logoPath: objectPath } });
                        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
                        pendingObjectPath.current = null;
                        toast({ title: "Logo uploaded successfully" });
                      }
                    }}
                    buttonClassName="w-full inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
                  >
                    <Upload className="h-4 w-4 mr-2" /> Upload New Logo
                  </ObjectUploader>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="codes" className="mt-4">
          <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
            <Card>
              <CardHeader>
                <CardTitle>Account Codes</CardTitle>
                <CardDescription>Nominal codes used in Xero.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Car Sales Code</Label>
                  <Input value={formData.carSalesCode} onChange={e => setFormData({...formData, carSalesCode: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>VAT Qualifying Code</Label>
                  <Input value={formData.vatQualifyingCode} onChange={e => setFormData({...formData, vatQualifyingCode: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Other Sales Code</Label>
                  <Input value={formData.otherSalesCode} onChange={e => setFormData({...formData, otherSalesCode: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Car Purchases Code</Label>
                  <Input value={formData.carPurchasesCode} onChange={e => setFormData({...formData, carPurchasesCode: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Stock Code</Label>
                  <Input value={formData.stockCode} onChange={e => setFormData({...formData, stockCode: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Auction Costs (No VAT) Code</Label>
                  <Input value={formData.auctionCostNoVatCode} onChange={e => setFormData({...formData, auctionCostNoVatCode: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Auction Costs (VAT) Code</Label>
                  <Input value={formData.auctionCostVatCode} onChange={e => setFormData({...formData, auctionCostVatCode: e.target.value})} />
                </div>
              </CardContent>
            </Card>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </form>
        </TabsContent>
        <TabsContent value="showroom" className="mt-4">
          <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
            <Card>
              <CardHeader>
                <CardTitle>Website Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3 rounded-md border border-slate-200 p-4">
                  <input
                    type="checkbox"
                    id="showroom-enabled"
                    className="mt-1 h-4 w-4"
                    checked={formData.showroomEnabled}
                    onChange={e => setFormData({ ...formData, showroomEnabled: e.target.checked })}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="showroom-enabled">Enable public website</Label>
                    <p className="text-xs text-slate-500">When enabled, published in-stock vehicles appear on your public website.</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Website Headline</Label>
                  <Input
                    placeholder="e.g. Quality Used Cars in Norwich"
                    value={formData.showroomHeadline}
                    onChange={e => setFormData({ ...formData, showroomHeadline: e.target.value })}
                  />
                  <p className="text-xs text-slate-500">Shown as the main heading at the top of your website.</p>
                </div>
                <div className="space-y-2">
                  <Label>Brand colour</Label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      aria-label="Brand colour"
                      className="h-10 w-14 cursor-pointer rounded-md border border-slate-200 bg-white p-1"
                      value={formData.invoiceAccentColour || DEFAULT_ACCENT}
                      onChange={e => setFormData({ ...formData, invoiceAccentColour: e.target.value })}
                    />
                    <Input
                      className="max-w-[140px] font-mono uppercase"
                      placeholder={DEFAULT_ACCENT}
                      value={formData.invoiceAccentColour}
                      onChange={e => setFormData({ ...formData, invoiceAccentColour: e.target.value })}
                    />
                    {formData.invoiceAccentColour.trim() && (
                      <button
                        type="button"
                        className="text-sm text-slate-500 hover:text-slate-800 hover:underline"
                        onClick={() => setFormData({ ...formData, invoiceAccentColour: "" })}
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Used for buttons, links and highlights on your website. Leave blank for the default green.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Background colour</Label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      aria-label="Background colour"
                      className="h-10 w-14 cursor-pointer rounded-md border border-slate-200 bg-white p-1"
                      value={formData.showroomBgColour || DEFAULT_BG}
                      onChange={e => setFormData({ ...formData, showroomBgColour: e.target.value })}
                    />
                    <Input
                      className="max-w-[140px] font-mono uppercase"
                      placeholder={DEFAULT_BG}
                      value={formData.showroomBgColour}
                      onChange={e => setFormData({ ...formData, showroomBgColour: e.target.value })}
                    />
                    {formData.showroomBgColour.trim() && (
                      <button
                        type="button"
                        className="text-sm text-slate-500 hover:text-slate-800 hover:underline"
                        onClick={() => setFormData({ ...formData, showroomBgColour: "" })}
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Used for the dark hero, footer and call-to-action areas of your website. Leave blank for the default dark navy.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Background text colour</Label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      aria-label="Background text colour"
                      className="h-10 w-14 cursor-pointer rounded-md border border-slate-200 bg-white p-1"
                      value={formData.showroomBgTextColour || DEFAULT_BG_TEXT}
                      onChange={e => setFormData({ ...formData, showroomBgTextColour: e.target.value })}
                    />
                    <Input
                      className="max-w-[140px] font-mono uppercase"
                      placeholder={DEFAULT_BG_TEXT}
                      value={formData.showroomBgTextColour}
                      onChange={e => setFormData({ ...formData, showroomBgTextColour: e.target.value })}
                    />
                    {formData.showroomBgTextColour.trim() && (
                      <button
                        type="button"
                        className="text-sm text-slate-500 hover:text-slate-800 hover:underline"
                        onClick={() => setFormData({ ...formData, showroomBgTextColour: "" })}
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Text shown on top of the background colour above. Leave blank for white.
                  </p>
                </div>
                <div className="rounded-md bg-slate-50 border border-slate-200 p-4">
                  <p className="text-sm font-medium text-slate-900">Your website link</p>
                  <a
                    href={`${basePath}/showroom`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#5f9128] hover:underline break-all"
                  >
                    {`${window.location.origin}${basePath}/showroom`}
                  </a>
                  <p className="text-xs text-slate-500 mt-1">Share this link with customers. It shows only published, in-stock vehicles.</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Home Page Wording</CardTitle>
                <CardDescription>
                  Edit the text on your website home page. Leave a field blank to use the standard wording.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Welcome text</Label>
                  <Textarea
                    rows={3}
                    placeholder={defaultShowroomIntro(formData.businessName)}
                    value={formData.showroomIntro}
                    onChange={e => setFormData({ ...formData, showroomIntro: e.target.value })}
                  />
                  <p className="text-xs text-slate-500">The short paragraph shown under the main heading on your home page.</p>
                </div>
                <div className="space-y-2">
                  <Label>"Why buy from us" heading</Label>
                  <Input
                    placeholder={DEFAULT_ABOUT_TITLE}
                    value={formData.showroomAboutTitle}
                    onChange={e => setFormData({ ...formData, showroomAboutTitle: e.target.value })}
                  />
                </div>
                <div className="space-y-3">
                  <Label>Selling points</Label>
                  <p className="text-xs text-slate-500">
                    The three cards in the "{formData.showroomAboutTitle.trim() || DEFAULT_ABOUT_TITLE}" section.
                  </p>
                  {formData.showroomFeatures.map((feat, i) => (
                    <div key={i} className="space-y-2 rounded-md border border-slate-200 p-3">
                      <p className="text-xs font-medium text-slate-500">Card {i + 1}</p>
                      <Input
                        placeholder={DEFAULT_FEATURES[i]?.title}
                        value={feat.title}
                        onChange={e => {
                          const next = formData.showroomFeatures.map((f, j) =>
                            j === i ? { ...f, title: e.target.value } : f,
                          );
                          setFormData({ ...formData, showroomFeatures: next });
                        }}
                      />
                      <Textarea
                        rows={2}
                        placeholder={DEFAULT_FEATURES[i]?.body}
                        value={feat.body}
                        onChange={e => {
                          const next = formData.showroomFeatures.map((f, j) =>
                            j === i ? { ...f, body: e.target.value } : f,
                          );
                          setFormData({ ...formData, showroomFeatures: next });
                        }}
                      />
                      <div className="flex items-center gap-3 pt-1">
                        <div className="h-12 w-12 shrink-0 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                          {feat.iconPath ? (
                            <img
                              src={`/api/storage${feat.iconPath}`}
                              alt={`Card ${i + 1} icon`}
                              className="h-full w-full object-contain p-1"
                            />
                          ) : (
                            <ImageIcon className="h-5 w-5 text-slate-300" />
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <ObjectUploader
                            allowedFileTypes={["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"]}
                            onGetUploadParameters={async (file) => {
                              const token = await getToken();
                              const res = await fetch("/api/storage/uploads/request-url", {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                                },
                                body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
                              });
                              if (!res.ok) {
                                throw new Error(`Failed to start upload (${res.status})`);
                              }
                              const { uploadURL, objectPath } = await res.json();
                              pendingObjectPath.current = objectPath;
                              return { method: "PUT", url: uploadURL, headers: { "Content-Type": file.type } };
                            }}
                            onComplete={(result) => {
                              const objectPath = pendingObjectPath.current;
                              if (result.successful?.[0] && objectPath) {
                                setFormData((prev) => ({
                                  ...prev,
                                  showroomFeatures: prev.showroomFeatures.map((f, j) =>
                                    j === i ? { ...f, iconPath: objectPath } : f,
                                  ),
                                }));
                                pendingObjectPath.current = null;
                                toast({ title: "Icon uploaded — remember to save changes" });
                              }
                            }}
                            buttonClassName="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3 py-2"
                          >
                            <Upload className="h-4 w-4 mr-2" /> {feat.iconPath ? "Replace icon" : "Upload icon"}
                          </ObjectUploader>
                          {feat.iconPath && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-slate-500"
                              onClick={() => {
                                const next = formData.showroomFeatures.map((f, j) =>
                                  j === i ? { title: f.title, body: f.body } : f,
                                );
                                setFormData({ ...formData, showroomFeatures: next });
                              }}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-slate-400">
                        Optional. Leave empty to use the default icon.
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Customer Reviews</CardTitle>
                <CardDescription>
                  Add reviews to show a "What our customers say" section on your home page.
                  Leave this empty to hide the section.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {formData.showroomReviews.length === 0 && (
                  <p className="text-sm text-slate-500">
                    No reviews added yet.
                  </p>
                )}
                {formData.showroomReviews.map((rev, i) => (
                  <div key={i} className="space-y-3 rounded-md border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-slate-500">Review {i + 1}</p>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-slate-500"
                          aria-label="Move review up"
                          disabled={i === 0}
                          onClick={() => moveReview(i, -1)}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-slate-500"
                          aria-label="Move review down"
                          disabled={i === formData.showroomReviews.length - 1}
                          onClick={() => moveReview(i, 1)}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-slate-500"
                          onClick={() =>
                            setFormData({
                              ...formData,
                              showroomReviews: formData.showroomReviews.filter((_, j) => j !== i),
                            })
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Reviewer name</Label>
                        <Input
                          placeholder="e.g. Sarah J."
                          value={rev.author}
                          onChange={e => {
                            const next = formData.showroomReviews.map((r, j) =>
                              j === i ? { ...r, author: e.target.value } : r,
                            );
                            setFormData({ ...formData, showroomReviews: next });
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Rating</Label>
                        <Select
                          value={String(rev.rating)}
                          onValueChange={(value) => {
                            const next = formData.showroomReviews.map((r, j) =>
                              j === i ? { ...r, rating: Number(value) } : r,
                            );
                            setFormData({ ...formData, showroomReviews: next });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[5, 4, 3, 2, 1].map((n) => (
                              <SelectItem key={n} value={String(n)}>
                                {n} {n === 1 ? "star" : "stars"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Review</Label>
                      <Textarea
                        rows={3}
                        placeholder="What did this customer say about you?"
                        value={rev.text}
                        onChange={e => {
                          const next = formData.showroomReviews.map((r, j) =>
                            j === i ? { ...r, text: e.target.value } : r,
                          );
                          setFormData({ ...formData, showroomReviews: next });
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Date (optional)</Label>
                      <Input
                        placeholder="e.g. March 2024"
                        value={rev.date ?? ""}
                        onChange={e => {
                          const next = formData.showroomReviews.map((r, j) =>
                            j === i ? { ...r, date: e.target.value } : r,
                          );
                          setFormData({ ...formData, showroomReviews: next });
                        }}
                      />
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setFormData({
                      ...formData,
                      showroomReviews: [
                        ...formData.showroomReviews,
                        { author: "", rating: 5, text: "" },
                      ],
                    })
                  }
                >
                  Add review
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Finance</CardTitle>
                <CardDescription>If you offer vehicle finance, show your FCA details on the public website.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3 rounded-md border border-slate-200 p-4">
                  <input
                    type="checkbox"
                    id="finance-provided"
                    className="mt-1 h-4 w-4"
                    checked={formData.financeProvided}
                    onChange={e => setFormData({ ...formData, financeProvided: e.target.checked })}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="finance-provided">Finance is provided</Label>
                    <p className="text-xs text-slate-500">When ticked, your finance details appear in a dedicated section of your website footer.</p>
                  </div>
                </div>
                {formData.financeProvided && (
                  <>
                    <div className="space-y-2">
                      <Label>FRN Number *</Label>
                      <Input value={formData.financeFrnNumber} onChange={e => setFormData({...formData, financeFrnNumber: e.target.value})} placeholder="e.g. 123456" />
                      <p className="text-xs text-slate-500">Your Financial Conduct Authority firm reference number.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Finance Wording *</Label>
                      <Textarea
                        rows={6}
                        value={formData.financeWording}
                        onChange={e => setFormData({...formData, financeWording: e.target.value})}
                        placeholder="e.g. We are a credit broker, not a lender, and can introduce you to a limited number of lenders..."
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </form>
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
        <TabsContent value="import" className="mt-4">
          <Import />
        </TabsContent>
      </Tabs>
    </div>
  );
}