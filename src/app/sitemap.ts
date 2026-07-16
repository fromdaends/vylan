import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";
import { routing } from "@/i18n/routing";
import { CATEGORY_SLUGS } from "@/content/help/manifest";
import { allArticlePaths } from "@/content/help/registry";

// The site's first sitemap. Next serves it at /sitemap.xml.
//
// PUBLIC MARKETING PAGES ONLY. Deliberately absent:
//   * /r/[token] — client portal links. These are private, per-client URLs.
//     Handing them to a crawler would be a data leak, not an SEO win.
//   * every /(app) route — behind auth; a crawler gets a redirect.
//   * /pricing — retired, 308s to the landing page.
//   * /onboarding, /demo/* — funnel pages, not destinations.
//
// Locale pairs use alternates.languages so Google serves the right one
// instead of picking for us. `localePrefix: "as-needed"` means English is
// unprefixed and French is /fr, which is why en has no prefix below.

const PREFIX: Record<(typeof routing.locales)[number], string> = {
  en: "",
  fr: "/fr",
};

// Marketing routes that existed before the help center. Kept in one list so
// adding a page later is a one-line change.
const STATIC_PATHS = [
  { path: "", priority: 1, changeFrequency: "weekly" as const },
  { path: "/how-it-works", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/contact", priority: 0.6, changeFrequency: "yearly" as const },
  { path: "/manifesto", priority: 0.5, changeFrequency: "yearly" as const },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicEnv().APP_URL.replace(/\/$/, "");

  const url = (path: string) => ({
    en: `${base}${PREFIX.en}${path}`,
    fr: `${base}${PREFIX.fr}${path}`,
  });

  const entry = (
    path: string,
    priority: number,
    changeFrequency: "weekly" | "monthly" | "yearly",
  ) => {
    const alt = url(path);
    return routing.locales.map((locale) => ({
      url: alt[locale],
      changeFrequency,
      priority,
      alternates: { languages: alt },
    }));
  };

  const helpPaths = [
    { path: "/help", priority: 0.8, changeFrequency: "weekly" as const },
    ...CATEGORY_SLUGS.map((c) => ({
      path: `/help/${c}`,
      priority: 0.7,
      changeFrequency: "monthly" as const,
    })),
    ...allArticlePaths().map(({ category, article }) => ({
      path: `/help/${category}/${article}`,
      priority: 0.6,
      changeFrequency: "monthly" as const,
    })),
  ];

  return [...STATIC_PATHS, ...helpPaths].flatMap((p) =>
    entry(p.path, p.priority, p.changeFrequency),
  );
}
