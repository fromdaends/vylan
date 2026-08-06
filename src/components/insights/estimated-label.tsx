"use client";

// "Estimated", with the honest tooltip — ONE component, used beside every
// profitability figure on the Insights page. The spec's wording, verbatim in
// the i18n key: estimated margin = revenue collected minus labor cost; does
// NOT include rent, software, or other overhead. One home so the wording can
// never drift between a stat card and a table header.

import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function EstimatedLabel() {
  const t = useTranslations("Insights");
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help items-center gap-1 text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
            {t("estimated")}
            <Info className="size-3" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-xs leading-relaxed">
          {t("estimated_tooltip")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
