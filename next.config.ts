import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable development features in production
  reactStrictMode: true,
  
  // Disable source maps in production to prevent debugging tools
  productionBrowserSourceMaps: false,
};

export default nextConfig;
