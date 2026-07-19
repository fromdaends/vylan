import { setRequestLocale, getTranslations } from "next-intl/server";
import { brand } from "@/lib/brand";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { assertLocale } from "@/lib/locale";
import { PublicNav } from "@/components/public/public-nav";
import { VylanFooter } from "@/components/vylan-landing/vylan-footer";

export const dynamic = "force-static";

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Terms");

  return (
    <main className="flex-1 flex flex-col pt-24 sm:pt-28">
      <PublicNav />

      <article className="mx-auto max-w-3xl px-6 py-16 space-y-6">
        <Alert variant="destructive">
          <AlertDescription>
            <strong>{t("draft_banner_title")}</strong> {t("draft_banner_body")}
          </AlertDescription>
        </Alert>

        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("updated", { date: "2026-05-12" })}
        </p>

        <Section heading={t("h_acceptance")} body={t("p_acceptance")} />
        <Section heading={t("h_service")} body={t("p_service")} />
        <Section heading={t("h_accounts")} body={t("p_accounts")} />
        <Section heading={t("h_subscription")} body={t("p_subscription")} />
        <Section heading={t("h_data")} body={t("p_data")} />
        <Section heading={t("h_acceptable_use")} body={t("p_acceptable_use")} />
        <Section heading={t("h_intellectual")} body={t("p_intellectual")} />
        <Section heading={t("h_termination")} body={t("p_termination")} />
        <Section heading={t("h_warranty")} body={t("p_warranty")} />
        <Section heading={t("h_law")} body={t("p_law")} />
        <Section heading={t("h_contact")} body={t("p_contact", { email: brand.supportEmail })} />
      </article>

      <VylanFooter />
    </main>
  );
}

function Section({ heading, body }: { heading: string; body: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold tracking-tight pt-2">{heading}</h2>
      <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
        {body}
      </p>
    </section>
  );
}
