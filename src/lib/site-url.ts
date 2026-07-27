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
  const explicit = env.APP_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);

  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${stripTrailingSlash(env.VERCEL_PROJECT_PRODUCTION_URL)}`;
  }

  const deployment = env.VERCEL_URL?.trim();
  if (deployment) return `https://${stripTrailingSlash(deployment)}`;

  return `https://${brand.domain}`;
}

function stripTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
