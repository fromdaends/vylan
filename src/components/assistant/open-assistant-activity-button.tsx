"use client";

import { useTranslations } from "next-intl";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";

// Replaces the old standalone ActivityDrawer trigger on draft engagements:
// same History icon in the same header spot, but it now opens the Assistant
// panel on its Activity tab (where the feed lives since the panel absorbed
// the slide-out).
export function OpenAssistantActivityButton() {
  const t = useTranslations("Activity");
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={t("title")}
      title={t("title")}
      onClick={() => {
        // scopeToPage: this control means "THIS engagement's activity", so
        // the panel must rescope to the current page even if already open.
        window.dispatchEvent(
          new CustomEvent("vylan:assistant:open", {
            detail: { tab: "activity", scopeToPage: true },
          }),
        );
      }}
    >
      <History className="size-4" aria-hidden />
    </Button>
  );
}
