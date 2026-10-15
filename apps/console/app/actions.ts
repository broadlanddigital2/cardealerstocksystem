"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, normaliseEmail, requestCode, signOut, verifyCode } from "@/lib/auth";
import { createDealer, getDealer, readDealerForm, slugTaken, updateDealer } from "@/lib/dealers";
import { pushModules, startSetup } from "@/lib/setup";
import { addDomain, checkDomain, listDomains, removeDomain } from "@/lib/domains";
import { startRelease } from "@/lib/releases";
import { setModuleEnabled, setModuleTier } from "@/lib/catalogue";

export interface FormState {
  error: string | null;
}

export async function sendCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = normaliseEmail(form.get("email"));
  if (!email) return { error: "Enter a valid email address." };
  try {
    await requestCode(email);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't send a code. Try again." };
  }
  redirect(`/sign-in?email=${encodeURIComponent(email)}`);
}

export async function verifyCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = normaliseEmail(form.get("email"));
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  if (!email) return { error: "Start again with your email address." };
  const error = await verifyCode(email, code);
  if (error) return { error };
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/sign-in");
}

export async function createDealerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await requireAdmin();
  const parsed = readDealerForm(form);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  if (await slugTaken(parsed.data.slug)) return { error: `The short id "${parsed.data.slug}" is already used.` };
  const dealer = await createDealer(parsed.data, actor);
  redirect(`/dealers/${dealer.id}?saved=1`);
}

export async function updateDealerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await requireAdmin();
  const id = Number(form.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Unknown dealer." };
  const parsed = readDealerForm(form);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  if (await slugTaken(parsed.data.slug, id)) return { error: `The short id "${parsed.data.slug}" is already used.` };
  const updated = await updateDealer(id, parsed.data, actor);
  // A live dealer's site gets module changes straight away.
  const pushError = await pushModules(updated);
  redirect(`/dealers/${id}?saved=1${pushError ? `&push=${encodeURIComponent(pushError)}` : ""}`);
}

export async function startSetupAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await requireAdmin();
  const id = Number(form.get("id"));
  const dealer = Number.isInteger(id) && id > 0 ? await getDealer(id) : null;
  if (!dealer) return { error: "Unknown dealer." };
  if (dealer.status !== "draft" && dealer.status !== "failed") {
    return { error: "This dealer is already set up or being set up." };
  }
  try {
    await startSetup(dealer, actor);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't start the setup." };
  }
  redirect(`/dealers/${dealer.id}`);
}

/** Re-renders the dealer page with fresh data (a hash-only redirect wouldn't reload it). */
function backToDomains(id: number): never {
  revalidatePath(`/dealers/${id}`);
  redirect(`/dealers/${id}?d=${Date.now()}#domains`);
}

async function dealerFromForm(form: FormData) {
  const id = Number(form.get("id"));
  return Number.isInteger(id) && id > 0 ? getDealer(id) : null;
}

export async function addDomainAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer) return { error: "Unknown dealer." };
  try {
    await addDomain(dealer, form.get("hostname"), form.get("kind"), actor);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't add the address." };
  }
  backToDomains(dealer.id);
}

export async function checkDomainsAction(form: FormData): Promise<void> {
  await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer) return;
  for (const d of await listDomains(dealer.id)) await checkDomain(d);
  backToDomains(dealer.id);
}

export async function removeDomainAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer) return;
  await removeDomain(dealer, Number(form.get("domainId")), actor);
  backToDomains(dealer.id);
}

export async function checkDomainAction(form: FormData): Promise<void> {
  await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer) return;
  const domain = (await listDomains(dealer.id)).find((d) => d.id === Number(form.get("domainId")));
  if (domain) await checkDomain(domain);
  backToDomains(dealer.id);
}

export async function startReleaseAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await requireAdmin();
  const id = Number(form.get("id"));
  const dealer = Number.isInteger(id) && id > 0 ? await getDealer(id) : null;
  if (form.get("id") && !dealer) return { error: "Unknown dealer." };
  try {
    await startRelease(actor, dealer ?? undefined);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't start the release." };
  }
  revalidatePath("/releases");
  redirect("/releases");
}

function backToModules(failed: string[]): never {
  revalidatePath("/modules");
  const q = failed.length ? `?unreached=${encodeURIComponent(failed.join(", "))}` : "?saved=1";
  redirect(`/modules${q}`);
}

export async function setModuleTierAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  backToModules(await setModuleTier(form.get("key"), form.get("tier"), actor));
}

export async function setModuleEnabledAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  backToModules(await setModuleEnabled(form.get("key"), form.get("enabled") === "true", actor));
}
