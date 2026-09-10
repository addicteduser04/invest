import type { NextConfig } from 'next';

// Next.js's own hydration payload (the `self.__next_f.push(...)` bootstrap script) is emitted
// inline, so script-src needs 'unsafe-inline' absent a full nonce-threading refactor across the
// client chart components (market-price-chart, compare-chart, masi-hero-chart,
// portfolio-performance-chart) that load TradingView Lightweight Charts from unpkg.com. That CDN
// script is pinned to an exact version and loaded with a Subresource Integrity hash, so
// script-src intentionally does not include 'unsafe-eval' -- eval is never required for a
// production Next.js build.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Vercel already sends this platform-side; set explicitly too so it holds if ever deployed
  // elsewhere. The site is HTTPS-only, so this is always correct.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

export default {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }];
  },
} satisfies NextConfig;
