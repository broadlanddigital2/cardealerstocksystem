import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useListFinanceCompanies,
  useCreateFinanceCompany,
  useUpdateFinanceCompany,
  useDeleteFinanceCompany,
  getListFinanceCompaniesQueryKey,
  type FinanceCompany,
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
import { PlusCircle, Loader2, Pencil, Trash2, Landmark } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  address: z.string().optional(),
  email: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const emptyValues: FormValues = {
  name: "",
  address: "",
  email: "",
};

export default function FinanceCompanies({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: companies, isLoading } = useListFinanceCompanies();
  const createCompany = useCreateFinanceCompany();
  const updateCompany = useUpdateFinanceCompany();
  const deleteCompany = useDeleteFinanceCompany();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceCompany | null>(null);
  const [toDelete, setToDelete] = useState<FinanceCompany | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListFinanceCompaniesQueryKey(),
    });

  const openAdd = () => {
    setEditing(null);
    form.reset(emptyValues);
    setDialogOpen(true);
  };

  const openEdit = (company: FinanceCompany) => {
    setEditing(company);
    form.reset({
      name: company.name,
      address: company.address ?? "",
      email: company.email ?? "",
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    try {
      if (editing) {
        await updateCompany.mutateAsync({ id: editing.id, data: values });
        toast({ title: "Finance company updated", description: values.name });
      } else {
        await createCompany.mutateAsync({ data: values });
        toast({ title: "Finance company added", description: values.name });
      }
      invalidate();
      setDialogOpen(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: editing
          ? "Error updating finance company"
          : "Error adding finance company",
        description: error?.error || "An unexpected error occurred.",
      });
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteCompany.mutateAsync({ id: toDelete.id });
      toast({ title: "Finance company deleted", description: toDelete.name });
      invalidate();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error deleting finance company",
        description: error?.error || "An unexpected error occurred.",
      });
    } finally {
      setToDelete(null);
    }
  };

  const isSubmitting = createCompany.isPending || updateCompany.isPending;

  return (
    <div className={embedded ? "space-y-6" : "p-8 max-w-7xl mx-auto space-y-6"}>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          {!embedded && (
            <h1 className="text-2xl font-bold text-slate-900">Finance Companies</h1>
          )}
          <p className="text-slate-500">
            Save finance company details to reuse them across the program.
          </p>
        </div>
        <Button onClick={openAdd}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Finance Company
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">
                      Loading finance companies...
                    </TableCell>
                  </TableRow>
                ) : companies?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center text-slate-500">
                      <div className="flex flex-col items-center gap-2">
                        <Landmark className="h-8 w-8 text-slate-300" />
                        <span>No finance companies yet. Add one to get started.</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  companies?.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium text-slate-900">{c.name}</TableCell>
                      <TableCell>{c.email || "-"}</TableCell>
                      <TableCell className="whitespace-pre-line">{c.address || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setToDelete(c)}
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
            <DialogTitle>
              {editing ? "Edit Finance Company" : "Add Finance Company"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Update this finance company's details."
                : "Save a finance company to reuse across the program."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl><Input placeholder="e.g. Black Horse Finance" {...field} /></FormControl>
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
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl><Textarea rows={3} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editing ? "Save Changes" : "Add Finance Company"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete finance company?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {toDelete?.name}. Records already
              referencing this finance company are not affected.
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
