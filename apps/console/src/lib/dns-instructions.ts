// The DNS records a dealer (or their web person) has to add, written up as a
// message they can be sent or that can be pasted into an email.

export interface InstructionRecord {
  type: string;
  name: string;
  value: string;
  priority?: number | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Host as most DNS providers ask for it: "@" for the domain itself, otherwise the part before the domain. */
export function hostFor(name: string, domain: string): string {
  const n = name.trim().replace(/\.$/, "").toLowerCase();
  if (n === "@" || n === "" || n === domain) return "@";
  return n.endsWith(`.${domain}`) ? n.slice(0, -(domain.length + 1)) : n;
}

export interface Instructions {
  subject: string;
  text: string;
  html: string;
}

export function buildInstructions(opts: {
  dealerName: string;
  domain: string;
  purpose: "email" | "web";
  records: InstructionRecord[];
  /** For a web address, the address itself (e.g. stock.manorgcs.co.uk). */
  address?: string;
}): Instructions {
  const { domain, purpose, records } = opts;
  const what =
    purpose === "email"
      ? `email for ${domain}`
      : `the web address ${opts.address ?? domain}`;
  const intro =
    purpose === "email"
      ? `To switch on ${what}, please add the DNS records below where ${domain}'s DNS is managed (usually the company the domain was bought from, or your web developer).`
      : `To point ${what} at your stock book, please add the DNS record below where ${domain}'s DNS is managed (usually the company the domain was bought from, or your web developer).`;
  const notes =
    purpose === "email"
      ? [
          'Host "@" means the domain itself (some providers want it left blank).',
          "Replace any existing MX records rather than keeping them alongside.",
          'There can only be one SPF record (the TXT starting "v=spf1"): replace the old one rather than adding a second.',
          "Changes usually take effect within an hour, occasionally up to 24 hours.",
        ]
      : [
          "If the provider offers a proxy or CDN option for this record, switch it off (DNS only).",
          "Changes usually take effect within an hour, occasionally up to 24 hours.",
        ];

  const rows = records.map((r) => ({
    type: r.type.toUpperCase(),
    host: hostFor(r.name, domain),
    value: r.value.replace(/\.$/, ""),
    priority: r.type.toUpperCase() === "MX" ? String(r.priority ?? 10) : "",
  }));

  const text = [
    "Hello,",
    "",
    intro,
    "",
    ...rows.map((r, i) =>
      [
        `${i + 1}. Type: ${r.type}`,
        `   Host / Name: ${r.host}`,
        `   Value: ${r.value}`,
        ...(r.priority ? [`   Priority: ${r.priority}`] : []),
      ].join("\n"),
    ),
    "",
    "Notes:",
    ...notes.map((n) => `- ${n}`),
    "",
    "Let us know once they're added and we'll check everything is working.",
    "",
    "Thanks",
  ].join("\n");

  const cell = "padding:6px 10px;border:1px solid #e2e8f0;vertical-align:top;";
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">
<p>Hello,</p>
<p>${esc(intro)}</p>
<table style="border-collapse:collapse;font-size:13px">
<tr style="background:#f8fafc"><th style="${cell}text-align:left">Type</th><th style="${cell}text-align:left">Host / Name</th><th style="${cell}text-align:left">Value</th><th style="${cell}text-align:left">Priority</th></tr>
${rows
  .map(
    (r) =>
      `<tr><td style="${cell}">${esc(r.type)}</td><td style="${cell}font-family:monospace">${esc(r.host)}</td><td style="${cell}font-family:monospace;word-break:break-all">${esc(r.value)}</td><td style="${cell}">${esc(r.priority)}</td></tr>`,
  )
  .join("\n")}
</table>
<p><strong>Notes</strong></p>
<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
<p>Let us know once they're added and we'll check everything is working.</p>
<p>Thanks</p>
</div>`;

  return {
    subject: purpose === "email" ? `DNS records to set up email for ${domain}` : `DNS record for ${opts.address ?? domain}`,
    text,
    html,
  };
}
