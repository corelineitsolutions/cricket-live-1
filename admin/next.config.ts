import type { NextConfig } from 'next';

/**
 * The panel is a browser client of the NestJS API. NEXT_PUBLIC_API_URL is inlined at
 * build time, so it must be set when running `npm run build` (see .env.example).
 */
const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const isProductionBuild = process.env.NODE_ENV === 'production';

if (isProductionBuild && !apiUrl) {
  throw new Error('NEXT_PUBLIC_API_URL must be set to the API origin (e.g. https://api.example.com) before building.');
}

function apiOrigin(): string {
  try {
    return apiUrl ? new URL(apiUrl).origin : '';
  } catch {
    throw new Error('NEXT_PUBLIC_API_URL must be an absolute URL, e.g. https://api.example.com');
  }
}

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; eval is only needed by the dev server.
  `script-src 'self' 'unsafe-inline'${isProductionBuild ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  // Ad creatives are hosted on external CDNs.
  "img-src 'self' https: data:",
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin()}${isProductionBuild ? '' : ' ws:'}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: __dirname },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
