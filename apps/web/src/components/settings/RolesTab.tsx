import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { MODULES, cleanModuleList, type ModuleKey } from "@/lib/modules";
import { ROLES_QUERY_KEY, sendRoles, useRoles, type RoleRow, type RolesResponse } from "./useRoles";

function errMessage(err: unknown): string {
  const data = (err as { data?: { error?: string } } | null)?.data;
  if (data?.error) return data.error;
  return err instanceof Error ? err.message : "Please try again.";
}

// Settings -> Roles: one column per role. Admin always has every module (plus
// Settings and Users). Staff is the default role for new people; admins can
// add roles such as "Sales" or "Accounts", rename them and delete them.
export default function RolesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useRoles();

  // Unsaved module ticks, per role key.
  const [draft, setDraft] = useState<Record<string, ModuleKey[]>>({});
  const [saving, setSaving] = useState(false);
  const [nameDialog, setNameDialog] = useState<{ mode: "add" } | { mode: "rename"; role: RoleRow } | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<RoleRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setDraft(Object.fromEntries(data.roles.map((r) => [r.key, r.modules])));
  }, [data]);

  const changedKeys = useMemo(() => {
    if (!data) return [];
    return data.roles
      .filter((r) => {
        const d = draft[r.key] ?? r.modules;
        return d.length !== r.modules.length || d.some((k) => !r.modules.includes(k));
      })
      .map((r) => r.key);
  }, [data, draft]);

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const roles = data.roles;
  const siteModules = MODULES.filter((m) => data.siteModules.includes(m.key));
  const notIncluded = MODULES.filter((m) => !data.siteModules.includes(m.key));

  const apply = (next: RolesResponse) => queryClient.setQueryData(ROLES_QUERY_KEY, next);

  const toggle = (roleKey: string, module: ModuleKey, on: boolean) =>
    setDraft((prev) => {
      const current = prev[roleKey] ?? [];
      return { ...prev, [roleKey]: cleanModuleList(on ? [...current, module] : current.filter((k) => k !== module)) };
    });

  const saveChanges = async () => {
    setSaving(true);
    try {
      let latest: RolesResponse | null = null;
      for (const key of changedKeys) {
        latest = await sendRoles(`/api/roles/${encodeURIComponent(key)}`, "PATCH", { modules: draft[key] ?? [] });
      }
      if (latest) apply(latest);
      toast({ title: "Roles saved", description: "People will see the change next time they open a page." });
    } catch (err) {
      toast({ title: "Could not save roles", description: errMessage(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const openAdd = () => {
    setNameValue("");
    setNameDialog({ mode: "add" });
  };
  const openRename = (role: RoleRow) => {
    setNameValue(role.name);
    setNameDialog({ mode: "rename", role });
  };

  const submitName = async () => {
    if (!nameDialog) return;
    setBusy(true);
    try {
      if (nameDialog.mode === "add") {
        // A new role starts with the same modules as Staff.
        const staff = roles.find((r) => r.isDefault);
        apply(await sendRoles("/api/roles", "POST", { name: nameValue, modules: staff?.modules ?? [] }));
        toast({ title: "Role added", description: `Tick what "${nameValue.trim()}" can use, then save.` });
      } else {
        apply(await sendRoles(`/api/roles/${encodeURIComponent(nameDialog.role.key)}`, "PATCH", { name: nameValue }));
        toast({ title: "Role renamed" });
      }
      setNameDialog(null);
    } catch (err) {
      toast({ title: "Could not save the role", description: errMessage(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const result = await sendRoles(`/api/roles/${encodeURIComponent(pendingDelete.key)}`, "DELETE");
      apply(result);
      await queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Role deleted",
        description: result.moved ? `${result.moved} ${result.moved === 1 ? "person" : "people"} moved to Staff.` : undefined,
      });
    } catch (err) {
      toast({ title: "Could not delete the role", description: errMessage(err), variant: "destructive" });
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Roles</CardTitle>
          <CardDescription>
            Choose what each role can use. Admins can always use everything, plus Settings and Users.
            The stock book itself (vehicles, purchases, sales and invoices) is available to everyone.
            Give people their role on the Users tab.
          </CardDescription>
        </div>
        <Button onClick={openAdd} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          Add role
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-4 font-medium text-left">Module</th>
                <th className="py-2 px-3 font-medium text-center min-w-24">Admin</th>
                {roles.map((r) => (
                  <th key={r.key} className="py-2 px-3 font-medium text-center min-w-28 align-bottom">
                    <div className="text-slate-900">{r.name}</div>
                    <div className="text-xs font-normal text-slate-400">
                      {r.userCount} {r.userCount === 1 ? "person" : "people"}
                      {r.isDefault ? " · default" : ""}
                    </div>
                    <div className="mt-1 flex justify-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openRename(r)} aria-label={`Rename ${r.name}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {!r.isDefault && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPendingDelete(r)} aria-label={`Delete ${r.name}`}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {siteModules.map((m) => (
                <tr key={m.key} className="border-b border-slate-100 align-top">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-slate-900">{m.name}</div>
                    <div className="text-xs text-slate-500">{m.description}</div>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <Checkbox checked disabled aria-label={`${m.name}: Admin`} />
                  </td>
                  {roles.map((r) => (
                    <td key={r.key} className="py-3 px-3 text-center">
                      <Checkbox
                        checked={(draft[r.key] ?? r.modules).includes(m.key)}
                        onCheckedChange={(v) => toggle(r.key, m.key, v === true)}
                        aria-label={`${m.name}: ${r.name}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {notIncluded.length > 0 && (
          <p className="text-xs text-slate-500">
            Not included in your plan: {notIncluded.map((m) => m.name).join(", ")}. Contact Broadland Digital to add them.
          </p>
        )}

        <Button onClick={saveChanges} disabled={changedKeys.length === 0 || saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      </CardContent>

      <Dialog open={nameDialog !== null} onOpenChange={(open) => !open && setNameDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{nameDialog?.mode === "rename" ? "Rename role" : "Add role"}</DialogTitle>
            <DialogDescription>
              {nameDialog?.mode === "rename"
                ? "The new name shows wherever this role appears."
                : "For example Sales or Accounts. It starts with the same modules as Staff; change them after adding it."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="role-name">Role name</Label>
            <Input
              id="role-name"
              value={nameValue}
              maxLength={40}
              autoFocus
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nameValue.trim()) void submitName();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNameDialog(null)}>
              Cancel
            </Button>
            <Button onClick={submitName} disabled={busy || !nameValue.trim()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {nameDialog?.mode === "rename" ? "Rename" : "Add role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the {pendingDelete?.name} role?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.userCount
                ? `${pendingDelete.userCount} ${pendingDelete.userCount === 1 ? "person has" : "people have"} this role and will move to Staff.`
                : "Nobody has this role at the moment."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={busy}>
              Delete role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
