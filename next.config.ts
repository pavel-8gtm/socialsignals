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
  
  // Exclude Supabase Edge Functions from Next.js compilation
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        'jsr:@supabase/supabase-js@2': 'commonjs jsr:@supabase/supabase-js@2',
        'jsr:@supabase/functions-js/edge-runtime.d.ts': 'commonjs jsr:@supabase/functions-js/edge-runtime.d.ts',
      });
    }
    return config;
  },
  
  // Exclude supabase functions directory from TypeScript compilation
  typescript: {
    ignoreBuildErrors: false,
  },
  
  // Exclude supabase functions from the build
  outputFileTracingExcludes: {
    '*': ['./supabase/functions/**/*'],
  },
};

export default nextConfig;
