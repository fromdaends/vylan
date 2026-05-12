import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { PLANS, type PlanId } from "@/lib/plans";
import { formatCurrency } from "@/lib/format";
import { assertLocale } from "@/lib/locale";
import { Check } from "lucide-react";
import { PublicFooter } from "@/components/public/public-footer";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Landing");
  const tAuth = await getTranslations("Auth");
  const tPricing = await getTranslations("Pricing");
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
              href="/pricing"
              className="text-muted-foreground hover:text-foreground hidden sm:inline"
            >
              {t("nav_pricing")}
            </Link>
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

      <section className="mx-auto max-w-3xl px-6 py-24">
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
          <Link href="/pricing">
            <Button variant="ghost" size="lg">
              {t("cta_secondary")}
            </Button>
          </Link>
        </div>
      </section>

      <section className="border-t border-border bg-card/40">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="grid gap-8 sm:grid-cols-3 text-sm">
            <Feature title={t("feature_1_title")} body={t("feature_1_body")} />
            <Feature title={t("feature_2_title")} body={t("feature_2_body")} />
            <Feature title={t("feature_3_title")} body={t("feature_3_body")} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-2xl font-semibold tracking-tight text-center mb-12">
          {t("how_title")}
        </h2>
        <div className="grid gap-8 sm:grid-cols-3">
          <Step n={1} title={t("step_1_title")} body={t("step_1_body")} />
          <Step n={2} title={t("step_2_title")} body={t("step_2_body")} />
          <Step n={3} title={t("step_3_title")} body={t("step_3_body")} />
        </div>
      </section>

      <section className="border-t border-border bg-card/40">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-2xl font-semibold tracking-tight text-center">
            {tPricing("title")}
          </h2>
          <p className="text-sm text-muted-foreground text-center mt-2">
            {tPricing("subtitle")}
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3 max-w-4xl mx-auto">
            {(["solo", "cabinet", "cabinet_plus"] as PlanId[]).map((planId) => (
              <PlanPreview key={planId} planId={planId} locale={locale} />
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/pricing">
              <Button variant="outline">{tPricing("see_all")}</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="text-2xl font-semibold tracking-tight text-center mb-10">
          {t("faq_title")}
        </h2>
        <dl className="space-y-6">
          <Faq q={t("faq_1_q")} a={t("faq_1_a")} />
          <Faq q={t("faq_2_q")} a={t("faq_2_a")} />
          <Faq q={t("faq_3_q")} a={t("faq_3_a")} />
          <Faq q={t("faq_4_q")} a={t("faq_4_a")} />
        </dl>
      </section>

      <PublicFooter />
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="font-medium">{title}</div>
      <p className="text-muted-foreground mt-1.5 leading-relaxed">{body}</p>
    </div>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="font-mono text-xs text-muted-foreground mb-2">0{n}</div>
      <div className="font-medium text-base">{title}</div>
      <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed">
        {body}
      </p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <dt className="font-medium">{q}</dt>
      <dd className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
        {a}
      </dd>
    </div>
  );
}

async function PlanPreview({
  planId,
  locale,
}: {
  planId: PlanId;
  locale: "fr" | "en";
}) {
  const t = await getTranslations("Pricing");
  const plan = PLANS[planId];
  const price =
    plan.monthlyCadCents != null
      ? formatCurrency(plan.monthlyCadCents / 100, locale, 0)
      : "—";
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="font-medium">{t(`plan_${planId}_name`)}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">
        {price}
        <span className="text-sm text-muted-foreground font-normal">
          {" "}
          / {t("per_month")}
        </span>
      </div>
      <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
        <li className="flex items-start gap-1.5">
          <Check
            className="size-3.5 text-success shrink-0 mt-0.5"
            aria-hidden
          />
          {t(`plan_${planId}_engagements`)}
        </li>
        <li className="flex items-start gap-1.5">
          <Check
            className="size-3.5 text-success shrink-0 mt-0.5"
            aria-hidden
          />
          {t(`plan_${planId}_users`)}
        </li>
        <li className="flex items-start gap-1.5">
          <Check
            className="size-3.5 text-success shrink-0 mt-0.5"
            aria-hidden
          />
          {t(`plan_${planId}_features`)}
        </li>
      </ul>
    </div>
  );
}
