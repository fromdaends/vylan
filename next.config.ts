import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [],
  },
  // archiver is a CommonJS module with `export = archiver` typings.
  // Turbopack tries to statically analyse its named exports and gets
  // confused by the namespace; treating it as a server-external
  // package leaves bundling alone and lets Node `require()` it at
  // runtime. The route handlers that use it (api/engagements/.../files.zip
  // and api/firm/export.zip) are nodejs-runtime only.
  serverExternalPackages: ["archiver"],
  experimental: {
    serverActions: {
      // Default is 1 MB — too small for phone photos (3-8 MB is normal).
      // Avatar + firm-logo uploads are Server Actions; bumping this to
      // match the in-app `MAX_BRANDING_HARD_LIMIT` (20 MB) means our own
      // size validation runs FIRST and returns a clean "too_large" error
      // instead of Next.js silently 500-ing before our code executes.
      // The 25 MB buffer leaves headroom for multipart-encoding overhead.
      bodySizeLimit: "25mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
