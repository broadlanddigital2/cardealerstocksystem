// Download one file of a removed dealer's data export (admins only).
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/auth";
import { getDealer } from "@/lib/dealers";
import { exportFileName, exportKeyBelongs } from "@/lib/removal";

interface R2Like {
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const dealer = await getDealer(Number((await params).id));
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!dealer || !exportKeyBelongs(dealer, key)) return new Response("Not found", { status: 404 });
  const bucket = (getCloudflareContext().env as unknown as { EXPORTS?: R2Like }).EXPORTS;
  if (!bucket) return new Response("Exports aren't connected.", { status: 503 });
  const obj = await bucket.get(key);
  if (!obj) return new Response("This export has gone (it's deleted with the dealer).", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(obj.size),
      "content-disposition": `attachment; filename="${exportFileName(key).replace(/"/g, "")}"`,
      "cache-control": "no-store",
    },
  });
}
