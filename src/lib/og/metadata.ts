import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { siteUrl } from "@/lib/site-url";
import { assertLocale } from "@/lib/locale";
import { routing, type AppLocale } from "@/i18n/routing";

/** The X/Twitter account linked in the site footer (VYLAN_SOCIALS). */
export const X_HANDLE = "@vylanapp";

/**
 * og:locale wants a language_TERRITORY pair, not a bare language code. Vylan
 * serves all of Canada in both official languages, so both sides are _CA.
 */
const OG_LOCALE: Record<AppLocale, string> = {
  en: "en_CA",
  fr: "fr_CA",
};

/** The other locale, for og:locale:alternate. */
const OG_LOCALE_ALTERNATE: Record<AppLocale, string> = {
  en: OG_LOCALE.fr,
  fr: OG_LOCALE.en,
};

/**
 * Builds the Open Graph + Twitter half of a page's metadata.
 *
 * NOTE ON IMAGES — deliberately absent. The card image comes from the
 * opengraph-image.tsx / twitter-image.tsx files at the [locale] segment root,
 * and Next gives file-based metadata priority over anything set in config. So
 * setting `openGraph.images` here would be dead code at best and, if the two
 * ever disagreed, a silent override. The files own the image; this owns the
 * words.
 *
 * `twitter.card: "summary_large_image"` is the tag that actually decides
 * whether X renders the big picture box or demotes the link to a small square
 * thumbnail. It is the whole point of this module.
 *
 * @param path Route path WITHOUT the locale prefix, e.g. "" or "/how-it-works".
 */
export function socialMetadata({
  locale,
  title,
  description,
  path = "",
}: {
  locale: string;
  title: string;
  description?: string;
  path?: string;
}): Pick<Metadata, "openGraph" | "twitter"> {
  const lang = assertLocale(locale);
  // localePrefix is "as-needed": English is unprefixed, French lives under /fr.
  const prefix = lang === routing.defaultLocale ? "" : `/${lang}`;
  const url = `${siteUrl()}${prefix}${path}`;

  return {
    openGraph: {
      type: "website",
      siteName: brand.name,
      locale: OG_LOCALE[lang],
      alternateLocale: OG_LOCALE_ALTERNATE[lang],
      url,
      title,
      ...(description ? { description } : {}),
    },
    twitter: {
      card: "summary_large_image",
      site: X_HANDLE,
      creator: X_HANDLE,
      title,
      ...(description ? { description } : {}),
    },
  };
}
