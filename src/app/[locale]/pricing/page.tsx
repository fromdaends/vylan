import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { Sparkles, Mail } from "lucide-react";
import { PublicNav } from "@/components/public/public-nav";
import { PublicFooter } from "@/components/public/public-footer";
import { BILLING_ENABLED } from "@/lib/billing-mode";
import { PaidPricingSection } from "./paid-pricing";

// While BILLING_ENABLED is false we replace the fixed-plan grid with
// a "talk to us" pitch — first clients get custom pricing through a
// direct conversation. The original grid still renders verbatim when
// the flag flips back to true; see PaidPricingSection below.
export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Pricing");

  return (
    <main className="flex-1 flex flex-col pt-24 sm:pt-28">
      <PublicNav />

      {BILLING_ENABLED ? (
        <PaidPricingSection locale={locale} />
      ) : (
        <section className="mx-auto max-w-3xl px-6 py-20">
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs font-medium text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
              {t("talk_banner")}
            </span>
          </div>

          <h1 className="mt-6 text-3xl sm:text-4xl font-semibold tracking-tight text-center">
            {t("talk_title")}
          </h1>
          <p className="mt-4 text-center text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            {t("talk_body")}
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 max-w-2xl mx-auto">
            <a
              href="mailto:hello@relai.app?subject=Pricing%20chat"
              className="group rounded-2xl border border-border bg-card p-6 transition-colors hover:border-foreground/20 hover:bg-secondary/30"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                <Mail className="h-5 w-5" />
              </span>
              <h3 className="mt-3 font-medium">{t("talk_email_heading")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("talk_email_body")}
              </p>
              <span className="mt-3 inline-block text-sm font-medium text-primary group-hover:underline">
                hello@relai.app
              </span>
            </a>

            <Link
              href="/signup"
              className="group rounded-2xl border border-border bg-card p-6 transition-colors hover:border-foreground/20 hover:bg-secondary/30"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                <Sparkles className="h-5 w-5" />
              </span>
              <h3 className="mt-3 font-medium">{t("talk_demo_heading")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("talk_demo_body")}
              </p>
              <span className="mt-3 inline-block text-sm font-medium text-primary group-hover:underline">
                {t("talk_demo_cta")}
              </span>
            </Link>
          </div>

          <p className="mt-12 text-center text-xs text-muted-foreground max-w-xl mx-auto">
            {t("talk_footnote")}
          </p>
        </section>
      )}

      <PublicFooter />
    </main>
  );
}
