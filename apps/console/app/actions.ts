"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, normaliseEmail, requestCode, signOut, verifyCode } from "@/lib/auth";
import { createDealer, getDealer, readDealerForm, slugTaken, updateDealer } from "@/lib/dealers";
import { pushModules, startSetup } from "@/lib/setup";
import { addDomain, checkDomain, cnameTarget, listDomains, removeDomain } from "@/lib/domains";
import { applyRecords, canEditZone, describeResult, findZone } from "@/lib/cloudflare-dns";
import { auditLogTable, getDb } from "@/db/client";
import { sendEmail } from "@/lib/email";
import { instructionsFor } from "@/lib/dns-instructions-server";
import { startRelease } from "@/lib/releases";
import { setModuleEnabled, setModuleTier } from "@/lib/catalogue";
import {
  addForwarding,
  createMailbox,
  deleteMailbox,
  getDnsRequirements,
  inviteMailbox,
  recheckDns,
  removeForwarding,
  resetMailboxPassword,
  setUpEmailDomain,
  trekmailConfigured,
} from "@/lib/trekmail";

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
  // Their email domain goes into TrekMail at the same time (best effort: the
  // Email section shows any problem and has its own button to try again).
  if (dealer.webDomain && !dealer.trekmailDomainId && trekmailConfigured()) {
    await setUpEmailDomain(dealer, actor).catch(() => {});
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

// ---- Email (TrekMail) ----

export interface EmailFormState {
  error: string | null;
  notice?: string;
  address?: string;
  /** Shown once, never stored. */
  password?: string;
}

function emailError(err: unknown): EmailFormState {
  return { error: err instanceof Error ? err.message : "Something went wrong with TrekMail." };
}

export async function setUpEmailAction(_prev: EmailFormState, form: FormData): Promise<EmailFormState> {
  const actor = await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer) return { error: "Unknown dealer." };
  try {
    await setUpEmailDomain(dealer, actor, form.get("domain"));
  } catch (err) {
    return emailError(err);
  }
  revalidatePath(`/dealers/${dealer.id}`);
  redirect(`/dealers/${dealer.id}?e=${Date.now()}#email`);
}

export async function recheckEmailDnsAction(form: FormData): Promise<void> {
  await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer?.trekmailDomainId) return;
  await recheckDns(dealer.trekmailDomainId).catch(() => {});
  // TrekMail queues the check; give it a moment before the page reads the result.
  await new Promise((r) => setTimeout(r, 4000));
  revalidatePath(`/dealers/${dealer.id}`);
  redirect(`/dealers/${dealer.id}?e=${Date.now()}#email`);
}

export async function addMailboxAction(_prev: EmailFormState, form: FormData): Promise<EmailFormState> {
  const actor = await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer) return { error: "Unknown dealer." };
  try {
    if (form.get("how") === "invite") {
      const address = await inviteMailbox(dealer, actor, form.get("local"), form.get("recipient"));
      revalidatePath(`/dealers/${dealer.id}`);
      return { error: null, notice: `Invitation for ${address} sent to ${String(form.get("recipient")).trim()}. The mailbox appears here once they accept it.` };
    }
    const r = await createMailbox(dealer, actor, form.get("local"), form.get("name"));
    revalidatePath(`/dealers/${dealer.id}`);
    return { error: null, address: r.address, password: r.password };
  } catch (err) {
    return emailError(err);
  }
}

export async function resetMailboxPasswordAction(_prev: EmailFormState, form: FormData): Promise<EmailFormState> {
  const actor = await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer) return { error: "Unknown dealer." };
  try {
    const r = await resetMailboxPassword(dealer, actor, Number(form.get("mailboxId")));
    return { error: null, address: r.address, password: r.password };
  } catch (err) {
    return emailError(err);
  }
}

export async function deleteMailboxAction(_prev: EmailFormState, form: FormData): Promise<EmailFormState> {
  const actor = await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer) return { error: "Unknown dealer." };
  try {
    await deleteMailbox(dealer, actor, Number(form.get("mailboxId")));
  } catch (err) {
    return emailError(err);
  }
  revalidatePath(`/dealers/${dealer.id}`);
  redirect(`/dealers/${dealer.id}?e=${Date.now()}#email`);
}

export async function addForwardingAction(_prev: EmailFormState, form: FormData): Promise<EmailFormState> {
  const actor = await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer) return { error: "Unknown dealer." };
  try {
    await addForwarding(dealer, actor, form.get("local"), form.get("recipients"));
  } catch (err) {
    return emailError(err);
  }
  revalidatePath(`/dealers/${dealer.id}`);
  redirect(`/dealers/${dealer.id}?e=${Date.now()}#email`);
}

export async function removeForwardingAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer) return;
  await removeForwarding(dealer, actor, Number(form.get("forwardingId"))).catch(() => {});
  revalidatePath(`/dealers/${dealer.id}`);
  redirect(`/dealers/${dealer.id}?e=${Date.now()}#email`);
}

// ---- Automatic DNS in Cloudflare ----

/** Back to the dealer page, watching the DNS checks live for the next 10 minutes. */
function watchRedirect(dealerId: number, what: "email" | "web", notice: string): never {
  revalidatePath(`/dealers/${dealerId}`);
  const until = Date.now() + 10 * 60_000;
  redirect(`/dealers/${dealerId}?watch=${what}&until=${until}&cf=${encodeURIComponent(notice)}#${what === "email" ? "email" : "domains"}`);
}

export async function applyEmailDnsAction(_prev: EmailFormState, form: FormData): Promise<EmailFormState> {
  const actor = await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer?.trekmailDomainId || !dealer.emailDomain) return { error: "Set up this dealer's email first." };
  let notice = "";
  try {
    const zone = await findZone(dealer.emailDomain);
    if (!zone || !(await canEditZone(zone.id))) return { error: `${dealer.emailDomain} isn't in a Cloudflare zone the console can edit.` };
    const { required_records } = await getDnsRequirements(dealer.trekmailDomainId);
    const r = await applyRecords(zone.id, dealer.emailDomain, required_records);
    await getDb().insert(auditLogTable).values({ actorEmail: actor, dealerId: dealer.id, action: "email.dns_applied", detail: { ...r } });
    await recheckDns(dealer.trekmailDomainId).catch(() => {});
    notice = describeResult(r);
  } catch (err) {
    return emailError(err);
  }
  watchRedirect(dealer.id, "email", notice);
}

export async function applyDomainDnsAction(_prev: EmailFormState, form: FormData): Promise<EmailFormState> {
  const actor = await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer) return { error: "Unknown dealer." };
  const domain = (await listDomains(dealer.id)).find((d) => d.id === Number(form.get("domainId")));
  if (!domain) return { error: "Unknown address." };
  let notice = "";
  try {
    const zone = await findZone(domain.hostname);
    if (!zone || !(await canEditZone(zone.id))) return { error: `${domain.hostname} isn't in a Cloudflare zone the console can edit.` };
    const wanted = domain.records.length ? domain.records : [{ type: "CNAME", name: domain.hostname, value: cnameTarget() }];
    const r = await applyRecords(zone.id, zone.name, wanted);
    await getDb().insert(auditLogTable).values({ actorEmail: actor, dealerId: dealer.id, action: "domain.dns_applied", detail: { hostname: domain.hostname, ...r } });
    await checkDomain(domain).catch(() => {});
    notice = describeResult(r);
  } catch (err) {
    return emailError(err);
  }
  watchRedirect(dealer.id, "web", notice);
}

/** Called every 20 seconds by the live DNS watch: asks TrekMail to check the email records again. */
export async function pollEmailDnsAction(dealerId: number): Promise<void> {
  await requireAdmin();
  const dealer = await getDealer(dealerId);
  if (dealer?.trekmailDomainId) await recheckDns(dealer.trekmailDomainId).catch(() => {});
}

/** Called every 20 seconds by the live DNS watch: re-checks the dealer's waiting web addresses. */
export async function pollDomainsAction(dealerId: number): Promise<void> {
  await requireAdmin();
  for (const d of await listDomains(dealerId)) if (d.status !== "active") await checkDomain(d).catch(() => {});
}

/** Emails the DNS instructions to the dealer (records are worked out again here, never taken from the form). */
export async function sendDnsInstructionsAction(_prev: EmailFormState, form: FormData): Promise<EmailFormState> {
  const actor = await requireAdmin();
  const dealer = await dealerFromForm(form);
  if (!dealer) return { error: "Unknown dealer." };
  const to = String(form.get("to") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: "Enter the email address to send them to." };
  try {
    const instructions = await instructionsFor(dealer, form.get("kind") === "web" ? Number(form.get("domainId")) : null);
    await sendEmail(to, instructions.subject, instructions.text, instructions.html);
    await getDb().insert(auditLogTable).values({
      actorEmail: actor,
      dealerId: dealer.id,
      action: "dns.instructions_sent",
      detail: { to, subject: instructions.subject },
    });
    return { error: null, notice: `Sent to ${to}.` };
  } catch (err) {
    return emailError(err);
  }
}
