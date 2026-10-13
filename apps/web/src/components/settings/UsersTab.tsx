import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAppUsers,
  useCreateAppUser,
  useUpdateAppUser,
  useDeleteAppUser,
  getListAppUsersQueryKey,
  type AppUser,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ROLES_QUERY_KEY, roleName, useRoles } from "./useRoles";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Loader2, UserPlus, Trash2, ShieldCheck } from "lucide-react";

type Role = string;

function errMessage(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string } } })?.response
    ?.data;
  return data?.error ?? "Something went wrong. Please try again.";
}

export default function UsersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: users = [], isLoading } = useListAppUsers();
  const createUser = useCreateAppUser();
  const updateUser = useUpdateAppUser();
  const deleteUser = useDeleteAppUser();
  const { data: rolesData } = useRoles();
  const roles = rolesData?.roles ?? [];

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("user");
  const [pendingDelete, setPendingDelete] = useState<AppUser | null>(null);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListAppUsersQueryKey() }),
      queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY }),
    ]);

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) {
      toast({ title: "Email is required", variant: "destructive" });
      return;
    }
    try {
      await createUser.mutateAsync({ data: { email, role: inviteRole } });
      await invalidate();
      toast({ title: "User invited", description: email });
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("user");
    } catch (err) {
      toast({ title: "Could not invite user", description: errMessage(err), variant: "destructive" });
    }
  };

  const handleRoleChange = async (user: AppUser, role: Role) => {
    if (role === user.role) return;
    try {
      await updateUser.mutateAsync({ id: user.id, data: { role } });
      await invalidate();
      toast({ title: "Role updated", description: `${user.email} is now ${roleName(role, roles)}` });
    } catch (err) {
      toast({ title: "Could not update permission", description: errMessage(err), variant: "destructive" });
      await invalidate();
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteUser.mutateAsync({ id: pendingDelete.id });
      await invalidate();
      toast({ title: "Access removed", description: pendingDelete.email });
    } catch (err) {
      toast({ title: "Could not remove access", description: errMessage(err), variant: "destructive" });
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Invite people to this stock book and choose their role. Admins can
            use everything, including Settings. What each other role can use is
            set on the Roles tab. Invited people sign in with the email address
            you add here.
          </CardDescription>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="shrink-0">
          <UserPlus className="h-4 w-4 mr-2" />
          Add user
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-slate-500 py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead className="w-[200px]">Role</TableHead>
                <TableHead className="w-[80px] text-right">Remove</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-slate-500 py-8">
                    No users yet. Add one to grant access.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => {
                  const editable = !user.locked && !user.isSelf;
                  return (
                    <TableRow key={`${user.id}-${user.email}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {user.email}
                          {user.isSelf && (
                            <Badge variant="outline">You</Badge>
                          )}
                          {user.locked && (
                            <Badge variant="secondary">
                              <ShieldCheck className="h-3 w-3 mr-1" />
                              Permanent admin
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <Select
                            value={user.role}
                            onValueChange={(v) => handleRoleChange(user, v as Role)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              {roles.map((r) => (
                                <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                            {roleName(user.role, roles)}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!editable}
                          onClick={() => setPendingDelete(user)}
                          aria-label={`Remove ${user.email}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>
              Enter the email address the person uses to sign in. They will get
              access the next time they sign in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="name@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>
                  ))}
                  <SelectItem value="admin">Admin — full access, including Settings</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={createUser.isPending}>
              {createUser.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDelete != null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove access?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.email} will no longer be able to sign in to this
              stock book. You can add them again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteUser.isPending}>
              {deleteUser.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
