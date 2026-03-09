import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // Large JSON backup imports pass through middleware/proxy before the route handler.
    proxyClientMaxBodySize: '25mb',
  },
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.twimg.com',
      },
    ],
  },
}

export default nextConfig
