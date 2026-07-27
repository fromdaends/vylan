import { brand } from "@/lib/brand";

/**
 * The absolute origin used to build PUBLIC, SHAREABLE urls — the Open Graph
 * image, the canonical link, the Twitter/X card.
 *
 * WHY THIS EXISTS INSTEAD OF JUST `publicEnv().APP_URL` — APP_URL falls back
 * to http://localhost:3000 when unset. That fallback is harmless everywhere it
 * is used today (robots.txt and sitemap.xml are only ever fetched from the real
 * host, so a bad value is visible and self-correcting), but it is FATAL for a
 * link preview: X fetches og:image as an absolute url from its own servers, and
 * "http://localhost:3000/..." resolves to the crawler's machine, not ours. The
 * card then renders with no image at all — silently, with nothing in our logs.
 *
 * A wrong-but-real production origin still produces a working card. Localhost
 * never does. So this resolver refuses to invent localhost: it only returns it
 * when APP_URL explicitly says so, which is exactly the local-dev case.
 *
 * Resolution order:
 *   1. APP_URL — the explicit, intentional setting. Always wins when set.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — the project's production domain, which
 *      Vercel injects on every deployment. Only trusted on production builds.
 *   3. VERCEL_URL — this specific deployment. Preview builds land here, so a
 *      preview link previews the preview rather than pointing at prod.
 *   4. https://vylan.app — the canonical domain, from the brand module.
 */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    env.APP_URL,
    env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined,
    `https://${brand.domain}`,
  ];

  for (const candidate of candidates) {
    const parsed = parseOrigin(candidate);
    if (parsed) return parsed;
  }

  // Unreachable: brand.domain is a constant and always parses. Present so the
  // function is total rather than relying on that staying true.
  return `https://${brand.domain}`;
}

/**
 * Returns the normalised origin, or null if the value isn't a usable absolute
 * url.
 *
 * THE VALIDATION MATTERS MORE THAN IT LOOKS. The caller feeds this straight
 * into `new URL()` for metadataBase, which runs on every page render — so a
 * misconfigured APP_URL (say "vylan.app", with the scheme forgotten) would not
 * merely break the share card, it would throw inside generateMetadata and 500
 * the entire site. Everywhere else APP_URL is read it goes through zod's
 * `.url()` in lib/env.ts; this path bypasses that on purpose (it must not
 * inherit env.ts's localhost default), so it has to do its own checking and
 * fall through to the next candidate instead of propagating a bad value.
 */
function parseOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return stripTrailingSlash(url.origin);
  } catch {
    return null;
  }
}

function stripTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
