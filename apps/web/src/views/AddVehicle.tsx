import { useState, useEffect } from "react";
import { useLocation } from "@/lib/router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateVehicle, useListSellers, useGetSettings, VehicleInputPurchaseType, getListVehiclesQueryKey, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Loader2 } from "lucide-react";
import { VehiclePhotosUploader } from "@/components/VehiclePhotosUploader";
import { RegistrationLookup } from "@/components/RegistrationLookup";

const formSchema = z.object({
  registrationNumber: z.string().min(1, "Registration is required"),
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  vin: z.string().optional(),
  colour: z.string().optional(),
  description: z.string().optional(),
  mileageAtPurchase: z.coerce.number().min(0).optional(),
  purchaseDate: z.string().min(1, "Purchase date is required"),
  purchaseInvoiceNumber: z.string().optional(),
  purchaseType: z.enum(["private", "auction", "trade", "part_exchange", "other"]),
  sellerName: z.string().min(1, "Seller name is required"),
  sellerAddress: z.string().optional(),
  purchasePrice: z.coerce.number().min(0, "Price must be positive"),
  vatQualifying: z.boolean().default(false),
  purchaseVat: z.coerce.number().min(0).optional(),
  auctionCostNoVat: z.coerce.number().min(0).optional(),
  auctionCostWithVat: z.coerce.number().min(0).optional(),
  purchaseNotes: z.string().optional(),
  purchaseDocumentReference: z.string().optional(),
  askingPrice: z.coerce.number().min(0).optional(),
  marketingDescription: z.string().optional(),
  published: z.boolean().default(false),
  photoUrls: z.array(z.string()).default([]),
});

type FormValues = z.infer<typeof formSchema>;

export default function AddVehicle() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      registrationNumber: "",
      make: "",
      model: "",
      vin: "",
      colour: "",
      description: "",
      mileageAtPurchase: undefined,
      purchaseDate: new Date().toISOString().split('T')[0],
      purchaseInvoiceNumber: "",
      purchaseType: "trade",
      sellerName: "",
      sellerAddress: "",
      purchasePrice: 0,
      vatQualifying: false,
      purchaseVat: undefined,
      auctionCostNoVat: undefined,
      auctionCostWithVat: undefined,
      purchaseNotes: "",
      purchaseDocumentReference: "",
      askingPrice: undefined,
      marketingDescription: "",
      published: false,
      photoUrls: [],
    },
  });

  const createVehicle = useCreateVehicle();
  const { data: sellers = [] } = useListSellers();
  const { data: settings } = useGetSettings();

  // When the vehicle is VAT qualifying, auto-calculate Purchase VAT from the net
  // purchase price using the dealer's configured VAT rate. Clear it otherwise.
  const vatQualifying = form.watch("vatQualifying");
  const purchasePrice = form.watch("purchasePrice");
  useEffect(() => {
    if (vatQualifying && settings?.vatRate) {
      const rate = Number(settings.vatRate);
      const net = Number(purchasePrice) || 0;
      if (!Number.isNaN(rate)) {
        form.setValue("purchaseVat", Math.round(net * (rate / 100) * 100) / 100);
      }
    } else if (!vatQualifying) {
      form.setValue("purchaseVat", undefined);
    }
  }, [vatQualifying, purchasePrice, settings?.vatRate, form]);
  const [selectedSellerId, setSelectedSellerId] = useState<string>("new");

  const handleSellerSelect = (value: string) => {
    setSelectedSellerId(value);
    if (value === "new") {
      form.setValue("sellerName", "");
      form.setValue("sellerAddress", "");
      return;
    }
    const seller = sellers.find((s) => String(s.id) === value);
    if (seller) {
      form.setValue("sellerName", seller.name, { shouldValidate: true });
      form.setValue("sellerAddress", seller.address ?? "");
    }
  };

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const result = await createVehicle.mutateAsync({ data: values });
      toast({
        title: "Vehicle added",
        description: `Successfully added ${result.make} ${result.model} (${result.registrationNumber})`,
      });
      queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      setLocation(`/vehicles/${result.id}`);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error adding vehicle",
        description: error?.error || "An unexpected error occurred.",
      });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/stock")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Add Vehicle</h1>
          <p className="text-slate-500">Record a new vehicle purchase into stock.</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Vehicle Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField control={form.control} name="registrationNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>Registration Number *</FormLabel>
                  <FormControl>
                    <RegistrationLookup
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      fields={{
                        make: form.watch("make"),
                        model: form.watch("model"),
                        vin: form.watch("vin"),
                        colour: form.watch("colour"),
                        description: form.watch("description"),
                      }}
                      onFill={(values) => {
                        Object.entries(values).forEach(([name, value]) => {
                          form.setValue(name as "make" | "model" | "vin" | "colour" | "description", value ?? "", { shouldDirty: true, shouldValidate: true });
                        });
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="vin" render={({ field }) => (
                <FormItem>
                  <FormLabel>VIN Number</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="make" render={({ field }) => (
                <FormItem>
                  <FormLabel>Make *</FormLabel>
                  <FormControl><Input placeholder="e.g. Ford" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="model" render={({ field }) => (
                <FormItem>
                  <FormLabel>Model *</FormLabel>
                  <FormControl><Input placeholder="e.g. Fiesta" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="mileageAtPurchase" render={({ field }) => (
                <FormItem>
                  <FormLabel>Mileage</FormLabel>
                  <FormControl><Input type="number" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="colour" render={({ field }) => (
                <FormItem>
                  <FormLabel>Colour</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Purchase Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField control={form.control} name="purchaseDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Purchase Date *</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="purchasePrice" render={({ field }) => (
                <FormItem>
                  <FormLabel>{form.watch("vatQualifying") ? "Purchase Price (Net) (£) *" : "Purchase Price (£) *"}</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="vatQualifying" render={({ field }) => (
                <FormItem className="md:col-span-2 flex flex-row items-start gap-3 rounded-md border p-4">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>VAT Qualifying Vehicle</FormLabel>
                    <FormDescription>
                      Tick if this vehicle is sold under standard VAT rules rather than the second-hand margin scheme. The purchase price is treated as net, with VAT entered separately.
                    </FormDescription>
                  </div>
                </FormItem>
              )} />
              {form.watch("vatQualifying") && (
                <FormField control={form.control} name="purchaseVat" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase VAT (£)</FormLabel>
                    <FormControl><Input type="number" step="0.01" readOnly {...field} value={field.value ?? ""} /></FormControl>
                    <FormDescription>Calculated automatically at the {settings?.vatRate ? `${settings.vatRate}%` : "settings"} VAT rate on the net purchase price.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
              <FormField control={form.control} name="purchaseType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Purchase Type *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="private">Private</SelectItem>
                      <SelectItem value="trade">Trade</SelectItem>
                      <SelectItem value="auction">Auction</SelectItem>
                      <SelectItem value="part_exchange">Part Exchange</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="purchaseInvoiceNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>Purchase Invoice Ref</FormLabel>
                  <FormControl><Input autoComplete="off" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              {form.watch("purchaseType") === "auction" && (
                <>
                  <FormField control={form.control} name="auctionCostNoVat" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Auction Costs That Have No VAT (£)</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ""} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="auctionCostWithVat" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Auction Costs That Have VAT (£)</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ""} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </>
              )}
              <div className="md:col-span-2 space-y-2">
                <Label>Select Saved Seller</Label>
                <Select value={selectedSellerId} onValueChange={handleSellerSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a saved seller or enter a one-off" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Enter new details (one-off seller)</SelectItem>
                    {sellers.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-slate-500">Pick a saved seller to auto-fill the details below, or enter a one-off seller manually.</p>
              </div>
              <FormField control={form.control} name="sellerName" render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Seller Name *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="sellerAddress" render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Seller Address</FormLabel>
                  <FormControl><Textarea {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="purchaseNotes" render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Textarea {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {settings?.showroomEnabled && (
          <Card>
            <CardHeader>
              <CardTitle>Website</CardTitle>
              <CardDescription>
                Photos, asking price and a marketing description for the public
                website. None of your accounting or purchase data is shown to
                customers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField control={form.control} name="photoUrls" render={({ field }) => (
                <FormItem>
                  <FormLabel>Photos</FormLabel>
                  <FormControl>
                    <VehiclePhotosUploader value={field.value ?? []} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="askingPrice" render={({ field }) => (
                <FormItem>
                  <FormLabel>Asking Price (£)</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="e.g. 8995" {...field} value={field.value ?? ""} /></FormControl>
                  <FormDescription>The price shown to customers on the website.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="marketingDescription" render={({ field }) => (
                <FormItem>
                  <FormLabel>Marketing Description</FormLabel>
                  <FormControl><Textarea rows={4} placeholder="Highlight the vehicle's condition, features and history for buyers." {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="published" render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3 rounded-md border p-4">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Publish to website</FormLabel>
                    <FormDescription>
                      When ticked, this vehicle appears on the public website
                      while it is in stock. It is automatically hidden once sold.
                    </FormDescription>
                  </div>
                </FormItem>
              )} />
            </CardContent>
          </Card>
          )}

          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => setLocation("/stock")}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save to Stock Book
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}