import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: ["@kdone/shared", "@kdone/db"],
  // `sharp` carries platform-specific native binaries. It is only used by the
  // worker's cover renderer, so keep it out of the serverless bundle instead of
  // letting webpack inline a binary that cannot load on Vercel.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;