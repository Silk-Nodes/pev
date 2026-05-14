import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone, dynamic Node.js app. No static export, no basePath.
  // Server components trace blocks on demand and (after Phase 3b) read
  // from Postgres.
};

export default nextConfig;
