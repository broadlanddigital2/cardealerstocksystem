import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MODULES, cleanModuleList, type ModuleKey } from "@/lib/modules";

interface RolesResponse {
  siteModules: ModuleKey[];
  roles: { admin: ModuleKey[]; staff: ModuleKey[] };
}

const ROLES_KEY = ["roles"];

// Settings -> Roles: the admin chooses which of the dealer's modules the
// Staff role ("User" on the Users tab) can use. Admins always have them all.
export default function RolesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ROLES_KEY,
    queryFn: () => customFetch<RolesResponse>("/api/roles"),
  });
  const [staff, setStaff] = useState<ModuleKey[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setStaff(cleanModuleList(data.roles.staff));
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const siteModules = MODULES.filter((m) => data.siteModules.includes(m.key));
  const notIncluded = MODULES.filter((m) => !data.siteModules.includes(m.key));
  const dirty =
    staff.length !== data.roles.staff.length || staff.some((k) => !data.roles.staff.includes(k));

  const toggle = (key: ModuleKey, on: boolean) =>
    setStaff((prev) => cleanModuleList(on ? [...prev, key] : prev.filter((k) => k !== key)));

  const save = async () => {
    setSaving(true);
    try {
      const updated = await customFetch<RolesResponse>("/api/roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staff }),
      });
      queryClient.setQueryData(ROLES_KEY, updated);
      toast({ title: "Roles saved", description: "Staff will see the change next time they open a page." });
    } catch (err) {
      toast({
        title: "Could not save roles",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles</CardTitle>
        <CardDescription>
          Choose what staff can use. Admins can always use everything, plus Settings and Users.
          The stock book itself (vehicles, purchases, sales and invoices) is always available to everyone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-4 font-medium">Module</th>
                <th className="py-2 px-4 font-medium text-center w-24">Admin</th>
                <th className="py-2 pl-4 font-medium text-center w-24">Staff</th>
              </tr>
            </thead>
            <tbody>
              {siteModules.map((m) => (
                <tr key={m.key} className="border-b border-slate-100 align-top">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-slate-900">{m.name}</div>
                    <div className="text-xs text-slate-500">{m.description}</div>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Checkbox checked disabled aria-label={`${m.name}: admin`} />
                  </td>
                  <td className="py-3 pl-4 text-center">
                    <Checkbox
                      checked={staff.includes(m.key)}
                      onCheckedChange={(v) => toggle(m.key, v === true)}
                      aria-label={`${m.name}: staff`}
                    />
                  </td>
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

        <Button onClick={save} disabled={!dirty || saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save roles
        </Button>
      </CardContent>
    </Card>
  );
}
