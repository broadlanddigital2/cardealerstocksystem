// Sends console email (sign-in codes) through SendGrid's HTTPS API.
export async function sendEmail(to: string, subject: string, text: string, html: string): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error("Email is not configured (SENDGRID_API_KEY / EMAIL_FROM).");
  const name = process.env.EMAIL_FROM_NAME?.trim();
  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: name ? { email: from, name } : { email: from },
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`SendGrid send failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
}
