"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { TemplateCard as TemplateCardView } from "@/components/templates/template-card";

export type TemplateCard = {
  id: string;
  name: string;
  type: "t1" | "t2" | "bookkeeping" | "custom";
  itemCount: number;
  requiredCount: number;
  /** First few item labels, already localized — the "peek inside". */
  preview: string[];
  builtIn: boolean;
};

// The templates gallery — a horizontal "start here" rail on the Overview page
// of every usable template (built-in starters + the firm's own). Only REAL
// templates show here (no "blank / from scratch" card — that's not a template;
// starting from scratch lives in the normal New-engagement flow). No category
// tabs or search either — that browsing/filtering lives on the full /templates
// page (the "Browse all" link); the Overview is just a quick start rail.
export function TemplatesGallery({ templates }: { templates: TemplateCard[] }) {
  const t = useTranslations("Dashboard");

  return (
    <section aria-label={t("tmpl_heading")} className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {t("tmpl_heading")}
        </h2>
        <Link
          href="/templates"
          className="shrink-0 text-sm font-medium text-primary hover:underline"
        >
          {t("tmpl_view_all")}
        </Link>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {templates.map((tmpl) => (
          <TemplateCardView
            key={tmpl.id}
            name={tmpl.name}
            type={tmpl.type}
            itemCount={tmpl.itemCount}
            requiredCount={tmpl.requiredCount}
            preview={tmpl.preview}
            href={`/engagements/new?template=${tmpl.id}`}
            className="w-[18rem] shrink-0"
          />
        ))}
      </div>
    </section>
  );
}
