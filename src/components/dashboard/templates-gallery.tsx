"use client";

import { createElement } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ChevronRight } from "lucide-react";
import {
  cleanLabel,
  resolveTemplateIcon,
} from "@/components/templates/template-card";

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

// The templates strip — a deliberately QUIET quick-start row near the bottom
// of the Overview. It used to be a rail of big preview cards in the prime
// middle strip; the Overview hierarchy rework demoted it below My engagements
// as a slim pill row (muted heading, compact items, no "peek inside"), so it
// reads as clearly secondary to the actual work. Browsing/filtering still
// lives on the full /templates page (the "Browse all" link). Only REAL
// templates show here (no "blank / from scratch" card — starting from scratch
// lives in the normal New-engagement flow).
export function TemplatesGallery({ templates }: { templates: TemplateCard[] }) {
  const t = useTranslations("Dashboard");
  const tTmpl = useTranslations("Templates");

  return (
    <section aria-label={t("tmpl_heading")} className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t("tmpl_heading")}
        </h2>
        <Link
          href="/templates"
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("tmpl_view_all")}
          <ChevronRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {templates.map((tmpl) => (
          <Link
            key={tmpl.id}
            href={`/engagements/new?template=${tmpl.id}`}
            className="group flex shrink-0 items-center gap-3 rounded-lg border border-border/50 bg-card/40 px-3.5 py-3.5 transition-colors hover:border-accent/40 hover:bg-card"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent transition-colors duration-200 group-hover:bg-accent group-hover:text-accent-foreground">
              {createElement(resolveTemplateIcon(tmpl.name, tmpl.type), {
                className: "h-4 w-4",
                "aria-hidden": true,
              })}
            </span>
            <span className="min-w-0">
              <span className="block max-w-[14rem] truncate text-sm font-medium text-foreground">
                {cleanLabel(tmpl.name)}
              </span>
              <span className="block text-xs tabular-nums text-muted-foreground">
                {tTmpl("documents_count", { count: tmpl.itemCount })}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
