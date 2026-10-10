import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Connection string for this request's database pool.
 *
 * On Cloudflare the Worker connects through Hyperdrive (binding `HYPERDRIVE`,
 * see wrangler.jsonc), which holds the TLS connection to Supabase and pools it.
 * Elsewhere (local dev, tests) this returns null and DATABASE_URL is used.
 */
export function requestDbConnectionString(): string | null {
  try {
    const env = getCloudflareContext().env as unknown as {
      HYPERDRIVE?: { connectionString?: string };
    };
    return env.HYPERDRIVE?.connectionString ?? null;
  } catch {
    return null;
  }
}
