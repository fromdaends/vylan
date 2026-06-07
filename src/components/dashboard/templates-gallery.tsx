"use client";

import { useTranslations } from "next-intl";
import { FilePlus2 } from "lucide-react";
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

// The templates gallery — a horizontal "start here" rail on the Overview page.
// A leading "blank" card starts from scratch, followed by every usable template
// (built-in starters + the firm's own). No category tabs or search here — that
// browsing/filtering lives on the full /templates page (the "Browse all" link);
// the Overview just offers a quick "start from a template" rail.
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
        <Link
          href="/engagements/new"
          className="group flex w-[18rem] shrink-0 flex-col justify-center gap-3 rounded-xl border border-dashed border-border/60 bg-card/40 p-4 transition-colors duration-200 hover:border-foreground/20 hover:bg-card"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-accent/10 group-hover:text-accent">
            <FilePlus2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {t("tmpl_blank_name")}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t("tmpl_blank_hint")}
            </div>
          </div>
        </Link>

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
