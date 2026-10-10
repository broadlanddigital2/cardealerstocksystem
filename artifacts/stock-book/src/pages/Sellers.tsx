import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useListSellers,
  useCreateSeller,
  useUpdateSeller,
  useDeleteSeller,
  getListSellersQueryKey,
  type Seller,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlusCircle, Loader2, Pencil, Trash2, Users } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contactName: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  vatNumber: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const emptyValues: FormValues = {
  name: "",
  contactName: "",
  address: "",
  phone: "",
  email: "",
  vatNumber: "",
  notes: "",
};

export default function Sellers({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: sellers, isLoading } = useListSellers();
  const createSeller = useCreateSeller();
  const updateSeller = useUpdateSeller();
  const deleteSeller = useDeleteSeller();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Seller | null>(null);
  const [toDelete, setToDelete] = useState<Seller | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListSellersQueryKey() });

  const openAdd = () => {
    setEditing(null);
    form.reset(emptyValues);
    setDialogOpen(true);
  };

  const openEdit = (seller: Seller) => {
    setEditing(seller);
    form.reset({
      name: seller.name,
      contactName: seller.contactName ?? "",
      address: seller.address ?? "",
      phone: seller.phone ?? "",
      email: seller.email ?? "",
      vatNumber: seller.vatNumber ?? "",
      notes: seller.notes ?? "",
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    try {
      if (editing) {
        await updateSeller.mutateAsync({ id: editing.id, data: values });
        toast({ title: "Seller updated", description: values.name });
      } else {
        await createSeller.mutateAsync({ data: values });
        toast({ title: "Seller added", description: values.name });
      }
      invalidate();
      setDialogOpen(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: editing ? "Error updating seller" : "Error adding seller",
        description: error?.error || "An unexpected error occurred.",
      });
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteSeller.mutateAsync({ id: toDelete.id });
      toast({ title: "Seller deleted", description: toDelete.name });
      invalidate();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error deleting seller",
        description: error?.error || "An unexpected error occurred.",
      });
    } finally {
      setToDelete(null);
    }
  };

  const isSubmitting = createSeller.isPending || updateSeller.isPending;

  return (
    <div className={embedded ? "space-y-6" : "p-8 max-w-7xl mx-auto space-y-6"}>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          {!embedded && (
            <h1 className="text-2xl font-bold text-slate-900">Sellers</h1>
          )}
          <p className="text-slate-500">
            Save details for suppliers you buy vehicles from regularly.
          </p>
        </div>
        <Button onClick={openAdd}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Seller
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>VAT No.</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      Loading sellers...
                    </TableCell>
                  </TableRow>
                ) : sellers?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                      <div className="flex flex-col items-center gap-2">
                        <Users className="h-8 w-8 text-slate-300" />
                        <span>No sellers yet. Add one to get started.</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  sellers?.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium text-slate-900">{s.name}</TableCell>
                      <TableCell>{s.contactName || "-"}</TableCell>
                      <TableCell>{s.phone || "-"}</TableCell>
                      <TableCell>{s.email || "-"}</TableCell>
                      <TableCell>{s.vatNumber || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setToDelete(s)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Seller" : "Add Seller"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update this seller's details."
                : "Save a supplier you buy vehicles from regularly."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl><Input placeholder="e.g. ABC Auctions Ltd" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="contactName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Name</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="vatNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>VAT Number</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl><Textarea rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Textarea rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editing ? "Save Changes" : "Add Seller"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete seller?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {toDelete?.name}. Vehicles already recorded
              against this seller are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
