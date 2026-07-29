import { renderShareCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/card";
import { routing } from "@/i18n/routing";

/**
 * The Open Graph image for every page under /[locale] — the picture that shows
 * up when a vylan.app link is pasted into X, LinkedIn, Slack, iMessage, or
 * anything else that reads OG tags.
 *
 * Living at the [locale] segment root means it is inherited by the landing
 * page, the manifesto, /how-it-works, the help centre and the legal
 * pages, so every public url previews without each page opting in. The client
 * portal at /r/[token] sits OUTSIDE this segment and deliberately gets nothing:
 * those urls are private, and a preview image is a way for a token to leak into
 * a group chat with a picture attached.
 *
 * ONE REDIRECT HOP ON ENGLISH, AND IT IS FINE. Next builds the og:image url
 * from the route's real segments, so English resolves to /en/opengraph-image —
 * but localePrefix is "as-needed", so next-intl then redirects that to the
 * unprefixed /opengraph-image. Verified against a production build: one hop,
 * 200, image/png. Every crawler that matters (X, Slack, LinkedIn, iMessage,
 * Discord) follows redirects on og:image, and French has no hop at all. Not
 * worth carving an exception into the proxy matcher to remove.
 */
export const alt = "Vylan — client paperwork, automated";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Prerender both locales at build time instead of rendering the PNG on demand.
// A crawler that has to wait for a cold serverless function to boot and rasterise
// an image is a crawler that may give up and show no card at all; there are only
// two of these and they never change between deploys, so there is no reason to
// pay that cost per request.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return renderShareCard(locale);
}
