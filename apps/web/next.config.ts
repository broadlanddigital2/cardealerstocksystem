import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, so Next compiles them.
  transpilePackages: [
    "@workspace/db",
    "@workspace/api-zod",
    "@workspace/api-client-react",
    "@workspace/object-storage-web",
    "@workspace/report-calc",
  ],
  // Type errors are caught by the dedicated `typecheck` CI step.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  // `pg` ships a Workers-specific socket implementation (pg-cloudflare) behind
  // the "workerd" export condition. Keeping these out of Next's own bundle lets
  // the OpenNext/Wrangler build resolve them with that condition; otherwise the
  // empty Node stub is bundled and connections fail ("… is not a constructor").
  serverExternalPackages: ["pg", "pg-cloudflare"],
};

export default nextConfig;

// Enables Cloudflare bindings/env during `next dev`.
if (process.env.NODE_ENV === "development") {
  import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev()).catch(() => {});
}
