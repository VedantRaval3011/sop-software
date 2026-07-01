import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  // Keep more dev pages compiled in memory so visiting a new route doesn't
  // evict/recompile shared chunks (e.g. root layout) and force-reload other open tabs.
  onDemandEntries: {
    maxInactiveAge: 60 * 60 * 1000,
    pagesBufferLength: 50,
  },
};

export default nextConfig;
