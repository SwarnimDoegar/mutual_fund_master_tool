import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal self-contained server for the Docker image (docker/web.Dockerfile).
  output: "standalone",
  reactCompiler: true,
  // Data is fetched from mf-api at request time and memoised per data version
  // (src/lib/api/server.ts); the static chrome of every page is prerendered.
  cacheComponents: true,
  partialPrefetching: true,
  // In-memory `use cache` store. Entries are keyed by data version, so a daily
  // refresh simply stops reading old entries and the LRU evicts them.
  cacheMaxMemorySize: 256 * 1024 * 1024,
  poweredByHeader: false,
  // The methodology page became the Learn section.
  async redirects() {
    return [{ source: "/methodology", destination: "/learn", permanent: true }];
  },
};

export default nextConfig;
