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
};

export default nextConfig;

// Enables Cloudflare bindings/env during `next dev`.
if (process.env.NODE_ENV === "development") {
  import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev()).catch(() => {});
}
