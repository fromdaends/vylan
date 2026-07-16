import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { routing } from "@/i18n/routing";
import { HelpShell, StillStuck } from "@/components/help-center/help-shell";
import {
  ArticleBody,
  headingId,
} from "@/components/help-center/article-body";
import { getArticle, getCategory } from "@/content/help/registry";
import { allArticlePaths } from "@/content/help/registry";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    allArticlePaths().map(({ category, article }) => ({
      locale,
      category,
      article,
    })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; category: string; article: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale, category, article } = await params;
  const locale = assertLocale(rawLocale);
  const found = getArticle(locale, category, article);
  if (!found) return {};
  const prefix = locale === "en" ? "" : `/${locale}`;
  return {
    title: `${found.article.title} · Vylan`,
    // The summary is written to stand alone precisely so it can do this job.
    description: found.article.summary,
    alternates: {
      canonical: `${prefix}/help/${category}/${article}`,
      languages: {
        en: `/help/${category}/${article}`,
        fr: `/fr/help/${category}/${article}`,
      },
    },
  };
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ locale: string; category: string; article: string }>;
}) {
  const { locale: rawLocale, category, article } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const found = getArticle(locale, category, article);
  if (!found) notFound();

  const t = await getTranslations("HelpCenter");
  const siblings = getCategory(locale, found.categorySlug).articles;
  const i = siblings.findIndex((a) => a.slug === article);
  const prev = i > 0 ? siblings[i - 1] : null;
  const next = i < siblings.length - 1 ? siblings[i + 1] : null;

  // The jump list earns its space on long articles only. Below four headings
  // it's just a second, worse table of contents sitting above the real one.
  const showToc = found.headings.length >= 4;

  return (
    <HelpShell locale={locale} title={found.article.title} compact>
      <article className="vyh-wrap-narrow">
        <nav className="vyh-crumbs" aria-label={t("breadcrumb_label")}>
          <Link href="/help">{t("breadcrumb_root")}</Link>
          <span className="vyh-crumb-sep" aria-hidden="true">
            /
          </span>
          <Link href={`/help/${found.categorySlug}`}>{found.categoryTitle}</Link>
          <span className="vyh-crumb-sep" aria-hidden="true">
            /
          </span>
          <span>{found.article.title}</span>
        </nav>

        <header className="vyh-article-head">
          <h1 className="vyh-article-title">{found.article.title}</h1>
          <p className="vyh-article-sum">{found.article.summary}</p>
        </header>

        {showToc ? (
          <nav className="vyh-toc" aria-label={t("toc_title")}>
            <div className="vyh-toc-title">{t("toc_title")}</div>
            <ol>
              {found.headings.map((heading) => (
                <li key={heading}>
                  <a href={`#${headingId(heading)}`}>{heading}</a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        <ArticleBody body={found.article.body} />

        {prev || next ? (
          <nav className="vyh-pager" aria-label={t("pager_label")}>
            {prev ? (
              <Link href={`/help/${found.categorySlug}/${prev.slug}`}>
                <div className="vyh-pager-dir">{t("pager_prev")}</div>
                <div className="vyh-pager-title">{prev.article.title}</div>
              </Link>
            ) : null}
            {next ? (
              <Link
                className="vyh-pager-next"
                href={`/help/${found.categorySlug}/${next.slug}`}
              >
                <div className="vyh-pager-dir">{t("pager_next")}</div>
                <div className="vyh-pager-title">{next.article.title}</div>
              </Link>
            ) : null}
          </nav>
        ) : null}

        <StillStuck locale={locale} />
      </article>
    </HelpShell>
  );
}
