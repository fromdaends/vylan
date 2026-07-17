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

// Extra armour for TOKEN-BEARING routes: the client portal (/r/<token>), its
// API (which serves the actual tax documents as PDFs/images), and teammate
// invites. These stack on top of securityHeaders; where a key repeats, this
// later, more-specific rule wins (Next applies matching header rules in
// order, last write per key).
//
//  * X-Robots-Tag — the page already carries <meta name="robots" noindex>,
//    but a PDF or JPEG response CANNOT carry a meta tag, so until now the
//    documents themselves had no robots directive at all. The header is the
//    only way to say noindex on non-HTML, and it also covers the page as
//    belt-and-braces. (Deliberately NOT robots.txt-disallowed — a crawler
//    must be able to FETCH these to read the directive; see src/app/robots.ts.)
//  * Referrer-Policy: no-referrer — the URL *is* the credential here. The
//    site-wide strict-origin-when-cross-origin already keeps the token out of
//    cross-origin Referer headers (only the origin is sent); no-referrer
//    removes even the same-origin referrer trail. Nothing reads referers, so
//    this costs nothing.
const tokenRouteHeaders = [
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive, nosnippet, noimageindex",
  },
  { key: "Referrer-Policy", value: "no-referrer" },
];

// The portal API additionally gets Cross-Origin-Resource-Policy so a leaked
// file URL cannot be hotlinked — <img>/<embed> of a client's document from any
// other origin is refused by the browser itself. Everything that legitimately
// consumes these responses (the portal page, pdf.js range requests, thumbs) is
// same-origin.
const portalApiHeaders = [
  ...tokenRouteHeaders,
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
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
    // Client-side router cache windows. Defaults are 0s for dynamic
    // pages, which means every tab click hits the server. Caching for
    // 30s makes "click back to a tab I just visited" instant — no
    // network round trip at all. Static pages (landing, /faq, /pricing)
    // cache for 5 min. Cache invalidation from our server actions
    // (revalidatePath) still propagates correctly; this only affects
    // navigations that happen without an intervening mutation.
    staleTimes: {
      dynamic: 30,
      static: 300,
    },
  },
  async headers() {
    // Order matters: the catch-all goes first so the token-route rules below
    // can override Referrer-Policy for their paths.
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/r/:path*",
        headers: tokenRouteHeaders,
      },
      {
        source: "/api/portal/:path*",
        headers: portalApiHeaders,
      },
      // Teammate invites: same shape as the portal — a private token URL.
      // With localePrefix "as-needed", English is unprefixed and French is
      // /fr, so both spellings need a rule.
      {
        source: "/invite/:path*",
        headers: tokenRouteHeaders,
      },
      {
        source: "/:locale(en|fr)/invite/:path*",
        headers: tokenRouteHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
