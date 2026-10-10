import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Mail, Phone, Car, Inbox, StickyNote } from "lucide-react";
import { formatDate } from "@/lib/format";

const basePath = "";

interface Lead {
  id: number;
  vehicleId: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  message: string;
  notes: string | null;
  status: string;
  createdAt: string;
  vehicle: {
    id: number;
    make: string;
    model: string;
    registrationNumber: string;
  } | null;
}

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  read: "Read",
  archived: "Archived",
};

export default function Leads() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "new" | "read" | "archived">("all");

  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ["enquiries"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${basePath}/api/enquiries`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`Failed to load leads (${res.status})`);
      return res.json();
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const token = await getToken();
      const res = await fetch(`${basePath}/api/enquiries/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Failed to update (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enquiries"] });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Could not update lead" });
    },
  });

  const saveNotes = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      const token = await getToken();
      const res = await fetch(`${basePath}/api/enquiries/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error(`Failed to save note (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enquiries"] });
      toast({ title: "Note saved" });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Could not save note" });
    },
  });

  const filtered = filter === "all" ? leads : leads.filter((l) => l.status === filter);
  const newCount = leads.filter((l) => l.status === "new").length;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Leads</h1>
        <p className="text-slate-500">
          Customer enquiries from your website.
          {newCount > 0 && ` ${newCount} new.`}
        </p>
      </div>

      <div className="flex gap-2">
        {(["all", "new", "read", "archived"] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : STATUS_LABELS[f]}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 p-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading leads...
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center text-slate-500">
            <Inbox className="h-10 w-10 mb-3 text-slate-300" />
            <p className="font-medium text-slate-700">No leads yet</p>
            <p className="text-sm">Enquiries submitted from your website will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((lead) => (
            <Card key={lead.id} className={lead.status === "new" ? "border-[#8DC63F]/50" : undefined}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{lead.name}</h3>
                      <Badge variant={lead.status === "new" ? "default" : "secondary"}>
                        {STATUS_LABELS[lead.status] ?? lead.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{formatDate(lead.createdAt)}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {lead.status !== "read" && (
                      <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: lead.id, status: "read" })}>
                        Mark read
                      </Button>
                    )}
                    {lead.status !== "archived" && (
                      <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ id: lead.id, status: "archived" })}>
                        Archive
                      </Button>
                    )}
                  </div>
                </div>

                {lead.vehicle && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Car className="h-4 w-4 text-slate-400" />
                    {lead.vehicle.make} {lead.vehicle.model} ({lead.vehicle.registrationNumber})
                  </div>
                )}

                <p className="text-sm text-slate-700 whitespace-pre-wrap">{lead.message}</p>

                <div className="flex flex-wrap gap-4 text-sm pt-1">
                  {lead.email && (
                    <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-[#5f9128] hover:underline">
                      <Mail className="h-4 w-4" /> {lead.email}
                    </a>
                  )}
                  {lead.phone && (
                    <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-[#5f9128] hover:underline">
                      <Phone className="h-4 w-4" /> {lead.phone}
                    </a>
                  )}
                </div>

                <LeadNotes
                  lead={lead}
                  onSave={(notes) => saveNotes.mutate({ id: lead.id, notes })}
                  isSaving={saveNotes.isPending && saveNotes.variables?.id === lead.id}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadNotes({
  lead,
  onSave,
  isSaving,
}: {
  lead: Lead;
  onSave: (notes: string) => void;
  isSaving: boolean;
}) {
  const [value, setValue] = useState(lead.notes ?? "");
  const dirty = value.trim() !== (lead.notes ?? "").trim();

  return (
    <div className="pt-2 border-t border-slate-100 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <StickyNote className="h-3.5 w-3.5" /> Internal note
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add a private note for your team (not visible to the customer)..."
        rows={2}
        maxLength={2000}
        className="text-sm"
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || isSaving}
          onClick={() => onSave(value.trim())}
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save note"}
        </Button>
      </div>
    </div>
  );
}
