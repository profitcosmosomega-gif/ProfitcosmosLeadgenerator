import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Server-only packages that must not be bundled.
  serverExternalPackages: ['pino', 'pg', 'pg-boss'],
};

export default nextConfig;
