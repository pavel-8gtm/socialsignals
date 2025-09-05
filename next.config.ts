import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable development features in production
  reactStrictMode: true,
  
  // Disable source maps in production to prevent debugging tools
  productionBrowserSourceMaps: false,
  
  // Configure external image domains
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'media.licdn.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
