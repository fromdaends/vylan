import { setRequestLocale, getTranslations } from "next-intl/server";
import { brand } from "@/lib/brand";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { assertLocale } from "@/lib/locale";
import { PublicNav } from "@/components/public/public-nav";
import { PublicFooter } from "@/components/public/public-footer";

export const dynamic = "force-static";

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Privacy");

  return (
    <main className="flex-1 flex flex-col pt-24">
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

        <Section heading={t("h_overview")} body={t("p_overview")} />
        <Section heading={t("h_what_we_collect")} body={t("p_what_we_collect")} />
        <Section heading={t("h_why")} body={t("p_why")} />
        <Section heading={t("h_law25")} body={t("p_law25")} />
        <Section heading={t("h_residency")} body={t("p_residency")} />
        <Section heading={t("h_sharing")} body={t("p_sharing")} />
        <Section heading={t("h_subprocessors")} body={t("p_subprocessors")} />
        <Section heading={t("h_security")} body={t("p_security")} />
        <Section heading={t("h_retention")} body={t("p_retention")} />
        <Section heading={t("h_rights")} body={t("p_rights")} />
        <Section heading={t("h_breach")} body={t("p_breach")} />
        <Section heading={t("h_contact")} body={t("p_contact", { email: brand.supportEmail })} />
      </article>

      <PublicFooter />
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
