import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/auth";
import { SignInForms } from "@/components/SignInForms";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  if (await currentAdmin()) redirect("/");
  const { email } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold">Stock Book Console</h1>
        <p className="mt-1 text-sm text-slate-500">Broadland Digital staff only.</p>
        <div className="mt-6">
          <SignInForms email={email ?? null} />
        </div>
      </div>
    </main>
  );
}
