import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import { ArrowLeft, UploadCloud, Sparkles, Download } from "lucide-react";
import { SageLogo } from "@/components/integrations/sage-logo";

// Sage 50 detail page. Mirrors the QuickBooks page's structure/quality so it
// feels native: brand hero, an honest explainer (Sage is desktop software, so
// there is no live connection — this is a file export), and a three-step "how it
// works" row. The export flow itself (engagement picker, preview, download)
// lands in Phase 3; a quiet footnote foreshadows it. Both themes via tokens,
// EN/FR via the Integrations namespace.
export default async function SageIntegrationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Integrations");

  // Three steps mirroring the QuickBooks connect page (same icon-tile pattern
  // and hues); step 3 swaps in a Download icon since Sage is export-and-import.
  const steps = [
    {
      icon: UploadCloud,
      color: "text-icon-blue",
      title: t("sage_step1_title"),
      desc: t("sage_step1_desc"),
    },
    {
      icon: Sparkles,
      color: "text-icon-purple",
      title: t("sage_step2_title"),
      desc: t("sage_step2_desc"),
    },
    {
      icon: Download,
      color: "text-icon-emerald",
      title: t("sage_step3_title"),
      desc: t("sage_step3_desc"),
    },
  ];

  return (
    <div className="mx-auto max-w-2xl py-10 animate-in-up sm:py-16">
      {/* Back link: its own row, left-aligned. */}
      <Link
        href="/integrations"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("index_title")}
      </Link>

      {/* Brand hero. */}
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
      </div>

      {/* How it works — three steps, no boxes; a hairline sets them off. Mirrors
          the QuickBooks connect page exactly. */}
      <div className="mt-12 border-t border-border/40 pt-8 text-left">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
          {t("sage_how_label")}
        </p>
        <ol className="mt-5 grid gap-7 sm:grid-cols-3 sm:gap-5">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <li
                key={i}
                className="flex flex-col items-center gap-3 text-center sm:items-start sm:text-left"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/60">
                  <Icon className={`size-5 ${step.color}`} aria-hidden />
                </span>
                <div className="space-y-1">
                  <div className="text-sm font-medium leading-snug">
                    {step.title}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {step.desc}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Quiet note: the export picker itself lands in the next phase. */}
      <p className="mt-10 text-center text-xs text-muted-foreground/70">
        {t("sage_ph_soon")}
      </p>
    </div>
  );
}
