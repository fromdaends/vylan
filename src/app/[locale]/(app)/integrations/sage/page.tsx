import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import { ArrowLeft } from "lucide-react";
import { SageLogo } from "@/components/integrations/sage-logo";

// Sage 50 detail page — PLACEHOLDER (Phase 1). The real hero, "how it works"
// row, engagement picker, preview and CSV download land in later phases. Kept
// intentionally minimal but on-brand so the card doesn't open onto a blank page.
export default async function SageIntegrationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Integrations");

  return (
    <div className="mx-auto max-w-2xl py-10 animate-in-up sm:py-16">
      {/* Back link: its OWN row, left-aligned. (Left the parent un-centered so
          this doesn't share a line with the centered hero below it.) */}
      <Link
        href="/integrations"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("index_title")}
      </Link>

      {/* Centered hero, on its own rows beneath the back link. */}
      <div className="mt-10 text-center sm:mt-14">
        <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[#00D639]/10 ring-1 ring-inset ring-[#00D639]/25">
          <SageLogo className="h-8 w-8" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t("sage_name")}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t("sage_detail_explainer")}
        </p>

        <div className="mx-auto mt-8 max-w-md rounded-xl bg-muted/30 px-4 py-3">
          <p className="text-sm text-muted-foreground">{t("sage_ph_soon")}</p>
        </div>
      </div>
    </div>
  );
}
