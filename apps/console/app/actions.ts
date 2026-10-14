"use server";

import { redirect } from "next/navigation";
import { requireAdmin, normaliseEmail, requestCode, signOut, verifyCode } from "@/lib/auth";
import { createDealer, getDealer, readDealerForm, slugTaken, updateDealer } from "@/lib/dealers";
import { pushModules, startSetup } from "@/lib/setup";

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
