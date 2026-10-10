import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

// Transactional email sender for dealer notifications. Emails are sent straight
// through the dealer's own mailbox over SMTP (e.g. their Fasthosts mailbox), so
// messages come directly from their real email address.
//
// Configuration (all optional; email simply no-ops if SMTP isn't configured):
//   SMTP_HOST  — outgoing mail server (e.g. smtp.livemail.co.uk for Fasthosts).
//   SMTP_PORT  — outgoing port. Defaults to 587 (STARTTLS). Use 465 for SSL.
//   SMTP_USER  — the full mailbox email address used to log in.
//   SMTP_PASS  — the mailbox password (stored as a secret).
//   SMTP_SECURE — "true" to force implicit TLS (set this for port 465).
//   ENQUIRY_EMAIL_FROM — the visible "from" address. Defaults to SMTP_USER.

function getFromAddress(): string {
  return (
    process.env.ENQUIRY_EMAIL_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    ""
  );
}

function getTransport(): Transporter | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT?.trim() || "587");
  const secure = process.env.SMTP_SECURE?.trim() === "true" || port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

export interface EnquiryEmailDetails {
  to: string;
  businessName: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  message: string;
  vehicle: {
    make: string | null;
    model: string | null;
    registrationNumber: string | null;
  } | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function vehicleLabel(vehicle: EnquiryEmailDetails["vehicle"]): string {
  if (!vehicle) return "General enquiry (no specific vehicle)";
  const parts = [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();
  const reg = vehicle.registrationNumber
    ? ` (${vehicle.registrationNumber})`
    : "";
  return parts ? `${parts}${reg}` : "Unspecified vehicle";
}

// Sends a notification email about a new customer enquiry. Best-effort: any
// failure (missing config, network, provider error) is logged and swallowed so
// it can never break enquiry submission. Returns true only when an email was
// actually dispatched.
export async function sendEnquiryNotification(
  details: EnquiryEmailDetails,
): Promise<boolean> {
  const transport = getTransport();
  const from = getFromAddress();
  if (!transport || !from) {
    logger.warn(
      "SMTP not configured — skipping enquiry notification email.",
    );
    return false;
  }

  const vehicle = vehicleLabel(details.vehicle);
  const contactLines = [
    details.customerEmail ? `Email: ${details.customerEmail}` : null,
    details.customerPhone ? `Phone: ${details.customerPhone}` : null,
  ].filter(Boolean) as Array<string>;

  const subject = `New enquiry from ${details.customerName} — ${vehicle}`;

  const textBody = [
    `You have a new customer enquiry from your showroom.`,
    ``,
    `Vehicle: ${vehicle}`,
    `Customer: ${details.customerName}`,
    ...contactLines,
    ``,
    `Message:`,
    details.message,
    ``,
    `— ${details.businessName || "Stock Book"}`,
  ].join("\n");

  const htmlBody = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">New customer enquiry</h2>
      <p style="margin: 0 0 16px;">You have a new enquiry from your showroom.</p>
      <table style="border-collapse: collapse; margin-bottom: 16px;">
        <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Vehicle</td><td style="padding: 4px 0;">${escapeHtml(vehicle)}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Customer</td><td style="padding: 4px 0;">${escapeHtml(details.customerName)}</td></tr>
        ${details.customerEmail ? `<tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Email</td><td style="padding: 4px 0;"><a href="mailto:${escapeHtml(details.customerEmail)}">${escapeHtml(details.customerEmail)}</a></td></tr>` : ""}
        ${details.customerPhone ? `<tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Phone</td><td style="padding: 4px 0;">${escapeHtml(details.customerPhone)}</td></tr>` : ""}
      </table>
      <div style="margin-bottom: 16px;">
        <div style="font-weight: bold; margin-bottom: 4px;">Message</div>
        <div style="white-space: pre-wrap; padding: 12px; background: #f5f5f5; border-radius: 6px;">${escapeHtml(details.message)}</div>
      </div>
      <p style="margin: 0; color: #666; font-size: 13px;">— ${escapeHtml(details.businessName || "Stock Book")}</p>
    </div>
  `;

  try {
    await transport.sendMail({
      from,
      to: details.to,
      subject,
      text: textBody,
      html: htmlBody,
      // Let the dealer reply straight to the customer when an email was given.
      ...(details.customerEmail
        ? { replyTo: details.customerEmail }
        : {}),
    });
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send enquiry notification email");
    return false;
  }
}

export interface CazooHealthAlertDetails {
  to: string;
  businessName: string;
  url: string;
  problems: Array<string>;
}

// Sends a warning email when the daily Cazoo health check detects that Cazoo
// changed their website and imports are likely broken. Best-effort: failures
// are logged and swallowed. Returns true only when an email was dispatched.
export async function sendCazooHealthAlert(
  details: CazooHealthAlertDetails,
): Promise<boolean> {
  const transport = getTransport();
  const from = getFromAddress();
  if (!transport || !from) {
    logger.warn("SMTP not configured — skipping Cazoo health alert email.");
    return false;
  }

  const business = details.businessName?.trim() || "Stock Book";
  const subject = "Warning: Cazoo imports may be broken — their website has changed";

  const textBody = [
    `The daily check of your Cazoo dealer page found a problem.`,
    ``,
    `Page checked: ${details.url}`,
    ``,
    `What went wrong:`,
    ...details.problems.map((p) => `- ${p}`),
    ``,
    `This usually means Cazoo has changed the layout of their website, so "Import from Cazoo" may bring in empty or incomplete cars until the app is updated.`,
    ``,
    `Ordinary imports you've already done are not affected. If you need to import new stock urgently, add the cars manually for now.`,
    ``,
    `— ${business} Stock Book`,
  ].join("\n");

  const htmlBody = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; line-height: 1.5;">
      <h2 style="margin: 0 0 12px; color: #b91c1c;">Cazoo imports may be broken</h2>
      <p style="margin: 0 0 12px;">The daily check of your Cazoo dealer page found a problem.</p>
      <p style="margin: 0 0 12px;">Page checked: <a href="${escapeHtml(details.url)}">${escapeHtml(details.url)}</a></p>
      <div style="margin-bottom: 16px;">
        <div style="font-weight: bold; margin-bottom: 4px;">What went wrong</div>
        <ul style="margin: 0; padding-left: 20px;">
          ${details.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}
        </ul>
      </div>
      <p style="margin: 0 0 12px;">This usually means Cazoo has changed the layout of their website, so <strong>Import from Cazoo</strong> may bring in empty or incomplete cars until the app is updated.</p>
      <p style="margin: 0 0 16px; color: #666; font-size: 13px;">Ordinary imports you've already done are not affected. If you need to import new stock urgently, add the cars manually for now.</p>
      <p style="margin: 0; color: #666; font-size: 13px;">— ${escapeHtml(business)} Stock Book</p>
    </div>
  `;

  try {
    await transport.sendMail({
      from,
      to: details.to,
      subject,
      text: textBody,
      html: htmlBody,
    });
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send Cazoo health alert email");
    return false;
  }
}

// Resolve the app's public base URL for sign-in links inside emails. Prefers an
// explicit APP_URL, falls
// back to empty (the email then omits the link button).
function getAppBaseUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return "";
}

export interface InviteEmailDetails {
  to: string;
  businessName: string;
  role: "admin" | "user";
}

// Sends a "you've been invited" email to a newly added staff member. Best-effort:
// any failure (missing config, network, provider error) is logged and swallowed
// so it can never break the invite action. Returns true only when an email was
// actually dispatched.
export async function sendInviteEmail(
  details: InviteEmailDetails,
): Promise<boolean> {
  const transport = getTransport();
  const from = getFromAddress();
  if (!transport || !from) {
    logger.warn("SMTP not configured — skipping staff invitation email.");
    return false;
  }

  const business = details.businessName?.trim() || "Stock Book";
  const base = getAppBaseUrl();
  const signInUrl = base ? `${base}/sign-up` : "";
  const accessNote =
    details.role === "admin"
      ? "You'll have full admin access, including reports and settings."
      : "You'll be able to manage stock, record sales and generate invoices.";

  const subject = `You've been invited to ${business} Stock Book`;

  const textBody = [
    `You've been given access to the ${business} Stock Book.`,
    ``,
    accessNote,
    ``,
    signInUrl
      ? `Create your account here using this email address (${details.to}) — if you already have one, just sign in:`
      : `Create your account (or sign in) using this email address: ${details.to}`,
    ...(signInUrl ? [signInUrl] : []),
    ``,
    `If you weren't expecting this, you can safely ignore this email.`,
    ``,
    `— ${business}`,
  ].join("\n");

  const htmlBody = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">You've been invited</h2>
      <p style="margin: 0 0 12px;">You've been given access to the <strong>${escapeHtml(business)}</strong> Stock Book.</p>
      <p style="margin: 0 0 16px;">${escapeHtml(accessNote)}</p>
      <p style="margin: 0 0 8px;">Create your account (or sign in, if you already have one) using this email address: <strong>${escapeHtml(details.to)}</strong></p>
      ${
        signInUrl
          ? `<p style="margin: 0 0 20px;"><a href="${escapeHtml(signInUrl)}" style="display: inline-block; background: #157ABE; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: bold;">Get started</a></p>`
          : ""
      }
      <p style="margin: 0 0 16px; color: #666; font-size: 13px;">If you weren't expecting this, you can safely ignore this email.</p>
      <p style="margin: 0; color: #666; font-size: 13px;">— ${escapeHtml(business)}</p>
    </div>
  `;

  try {
    await transport.sendMail({
      from,
      to: details.to,
      subject,
      text: textBody,
      html: htmlBody,
    });
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send staff invitation email");
    return false;
  }
}
