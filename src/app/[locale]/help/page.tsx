import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { HelpShell } from "@/components/help-center/help-shell";
import { getCategories } from "@/content/help/registry";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "HelpCenter" });
  return {
    title: t("meta_title"),
    description: t("meta_description"),
    alternates: {
      canonical: locale === "en" ? "/help" : `/${locale}/help`,
      languages: { en: "/help", fr: "/fr/help" },
    },
  };
}

export default async function HelpIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const t = await getTranslations("HelpCenter");
  const categories = getCategories(locale);

  return (
    <HelpShell locale={locale} title={t("hero_title")} sub={t("hero_sub")}>
      <div className="vyh-wrap">
        <div className="vyh-eyebrow">{t("browse_eyebrow")}</div>
        <h2 className="vyh-h2">{t("browse_title")}</h2>
        <div className="vyh-grid">
          {categories.map((c) => (
            <Link className="vyh-card" href={`/help/${c.slug}`} key={c.slug}>
              <div className="vyh-card-title">{c.meta.title}</div>
              <div className="vyh-card-desc">{c.meta.description}</div>
              <div className="vyh-card-count">
                {t("article_count", { count: c.articles.length })}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </HelpShell>
  );
}
