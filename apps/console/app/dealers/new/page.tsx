import { requireAdmin } from "@/lib/auth";
import { defaultModules } from "@/lib/dealers";
import { getCatalogue } from "@/lib/catalogue";
import { Shell } from "@/components/Shell";
import { DealerForm } from "@/components/DealerForm";
import { createDealerAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewDealerPage() {
  const admin = await requireAdmin();
  const catalogue = await getCatalogue();
  return (
    <Shell admin={admin}>
      <a href="/" className="text-sm text-slate-500 hover:underline">← Dealers</a>
      <h1 className="mt-2 mb-6 text-2xl font-bold">Add dealer</h1>
      <DealerForm
        action={createDealerAction}
        catalogue={catalogue}
        submitLabel="Add dealer"
        values={{
          name: "", slug: "", companyNumber: "", contactName: "", contactEmail: "", contactPhone: "",
          billingEmail: "", webDomain: "", staffDomain: "", showroomDomain: "", firstAdminEmail: "",
          modules: defaultModules(catalogue), pilot: false, notes: "",
        }}
      />
    </Shell>
  );
}
