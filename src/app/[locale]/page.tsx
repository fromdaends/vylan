import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { brand } from "@/lib/brand";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Landing");
  const otherLocale = locale === "fr" ? "en" : "fr";

  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
          <Link href="/" className="font-semibold tracking-tight text-lg">
            {brand.name}
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link
              href="/"
              locale={otherLocale}
              className="hover:text-foreground"
            >
              {otherLocale.toUpperCase()}
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
        <div className="mt-10 text-sm text-muted-foreground font-mono">
          {brand.name} · phase 1 scaffold
        </div>
      </section>
    </main>
  );
}
