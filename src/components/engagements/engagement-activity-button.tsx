"use client";

import { useTranslations } from "next-intl";
import { History } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

// Draft engagements keep a standalone Activity affordance in the header (they
// have no "..." menu). It links to the firm activity log, pre-filtered to this
// engagement's client — the same destination as the Activity item in the "..."
// menu on sent engagements. No longer owner-gated at the call site: the log is
// open to every member and hides private clients per-viewer in the database.
export function EngagementActivityButton({ clientId }: { clientId: string }) {
  const t = useTranslations("Activity");
  return (
    <Button
      asChild
      variant="outline"
      size="icon-sm"
      aria-label={t("title")}
      title={t("title")}
    >
      <Link href={`/settings/audit?client=${encodeURIComponent(clientId)}`}>
        <History className="size-4" aria-hidden />
      </Link>
    </Button>
  );
}
