import { renderShareCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/card";
import { routing } from "@/i18n/routing";

/**
 * The X/Twitter card image.
 *
 * X *will* fall back to og:image when twitter:image is absent, so this file is
 * belt-and-braces rather than strictly required — but it is cheap, and it means
 * the card keeps working if the OG tags are ever narrowed for another platform.
 * It renders the identical card (same renderShareCard call), so the two images
 * cannot drift apart.
 */
export const alt = "Vylan — client paperwork, automated";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** Prerendered at build time for the same reason as the Open Graph image. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function TwitterImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return renderShareCard(locale);
}
