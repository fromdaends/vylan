"use client";

// "Estimated", with the honest tooltip — ONE component, used beside every
// profitability figure on the Insights page. The spec's wording, verbatim in
// the i18n key: estimated margin = revenue collected minus labor cost; does
// NOT include rent, software, or other overhead. One home so the wording can
// never drift between a stat card and a table header.
//
// The icon-and-tooltip mechanics are InfoHint's now; what stays here is the
// only thing that was ever specific to Insights — these two strings.

import { useTranslations } from "next-intl";
import { InfoHint } from "@/components/ui/info-hint";

export function EstimatedLabel() {
  const t = useTranslations("Insights");
  return (
    <InfoHint
      text={t("estimated_tooltip")}
      className="text-[11px] font-normal uppercase tracking-wide"
      iconClassName="size-3"
    >
      {t("estimated")}
    </InfoHint>
  );
}
