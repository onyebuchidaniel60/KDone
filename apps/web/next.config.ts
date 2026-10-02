import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: ["@kdone/shared", "@kdone/db"],
};

export default nextConfig;