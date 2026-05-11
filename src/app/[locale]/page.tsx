import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Landing");
  const tAuth = await getTranslations("Auth");
  const otherLocale = locale === "fr" ? "en" : "fr";

  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
          <Link href="/" className="font-semibold tracking-tight text-lg">
            {brand.name}
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link
              href="/"
              locale={otherLocale}
              className="text-muted-foreground hover:text-foreground"
            >
              {otherLocale.toUpperCase()}
            </Link>
            <Link href="/login">
              <Button variant="ghost" size="sm">
                {tAuth("sign_in")}
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">{tAuth("create_account")}</Button>
            </Link>
          </nav>
        </div>
      </header>

      <section className="flex-1 mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-tight">
          {t("headline")}
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
          {t("subhead")}
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/signup">
            <Button size="lg">{t("cta_primary")}</Button>
          </Link>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-3 text-sm">
          <FeatureBlock title={t("feature_1_title")} body={t("feature_1_body")} />
          <FeatureBlock title={t("feature_2_title")} body={t("feature_2_body")} />
          <FeatureBlock title={t("feature_3_title")} body={t("feature_3_body")} />
        </div>
      </section>
    </main>
  );
}

function FeatureBlock({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="font-medium">{title}</div>
      <p className="text-muted-foreground mt-1.5 leading-relaxed">{body}</p>
    </div>
  );
}
