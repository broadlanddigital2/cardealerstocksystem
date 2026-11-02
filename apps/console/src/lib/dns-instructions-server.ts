// Works out a dealer's current DNS instructions (email records from TrekMail,
// or a web address's records), for the copy box and the "Email to dealer" button.
import type { Dealer } from "@/db/client";
import { cnameTarget, listDomains } from "@/lib/domains";
import { getDnsRequirements } from "@/lib/trekmail";
import { buildInstructions, type Instructions } from "@/lib/dns-instructions";

/** domainId null = the dealer's email records; otherwise that web address. */
export async function instructionsFor(dealer: Dealer, domainId: number | null): Promise<Instructions> {
  if (domainId == null) {
    if (!dealer.trekmailDomainId || !dealer.emailDomain) throw new Error("Set up this dealer's email first.");
    const { required_records } = await getDnsRequirements(dealer.trekmailDomainId);
    return buildInstructions({ dealerName: dealer.name, domain: dealer.emailDomain, purpose: "email", records: required_records });
  }
  const d = (await listDomains(dealer.id)).find((x) => x.id === domainId);
  if (!d) throw new Error("Unknown address.");
  const records = d.records.length ? d.records : [{ type: "CNAME", name: d.hostname, value: cnameTarget() }];
  // The part of the address the dealer's DNS provider holds, e.g. manorgcs.co.uk for stock.manorgcs.co.uk.
  const base = d.hostname.split(".").length > 2 ? d.hostname.split(".").slice(1).join(".") : d.hostname;
  return buildInstructions({ dealerName: dealer.name, domain: base, purpose: "web", records, address: d.hostname });
}
