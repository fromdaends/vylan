import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { routing } from "@/i18n/routing";
import { HelpShell, StillStuck } from "@/components/help-center/help-shell";
import {
  getCategory,
  getCategories,
  isCategorySlug,
} from "@/content/help/registry";

// Fully static: the content is compiled in, so there is nothing to fetch and
// no reason to render these per request. Per-locale, so French doesn't
// prerender a category with nothing translated in it yet.
export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getCategories(locale).map((c) => ({ locale, category: c.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; category: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale, category } = await params;
  if (!isCategorySlug(category)) return {};
  const locale = assertLocale(rawLocale);
  const c = getCategory(locale, category);
  const prefix = locale === "en" ? "" : `/${locale}`;
  return {
    title: `${c.meta.title} · Vylan`,
    description: c.meta.description,
    alternates: {
      canonical: `${prefix}/help/${category}`,
      languages: {
        en: `/help/${category}`,
        fr: `/fr/help/${category}`,
      },
    },
  };
}

export default async function HelpCategoryPage({
  params,
}: {
  params: Promise<{ locale: string; category: string }>;
}) {
  const { locale: rawLocale, category } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  if (!isCategorySlug(category)) notFound();
  const c = getCategory(locale, category);
  // Nothing translated in this locale yet: 404 rather than render a category
  // page with an empty list. Nothing links here in that locale anyway.
  if (c.articles.length === 0) notFound();
  const t = await getTranslations("HelpCenter");

  return (
    <HelpShell locale={locale} title={c.meta.title} sub={c.meta.description} compact>
      <div className="vyh-wrap-narrow">
        <nav className="vyh-crumbs" aria-label={t("breadcrumb_label")}>
          <Link href="/help">{t("breadcrumb_root")}</Link>
          <span className="vyh-crumb-sep" aria-hidden="true">
            /
          </span>
          <span>{c.meta.title}</span>
        </nav>

        <div className="vyh-list">
          {c.articles.map(({ slug, article }) => (
            <Link
              className="vyh-list-item"
              href={`/help/${category}/${slug}`}
              key={slug}
            >
              <span>
                <span className="vyh-list-title">{article.title}</span>
                <span className="vyh-list-sum" style={{ display: "block" }}>
                  {article.summary}
                </span>
              </span>
              <span className="vyh-list-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>

        <StillStuck locale={locale} />
      </div>
    </HelpShell>
  );
}
