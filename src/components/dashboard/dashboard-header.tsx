"use client";

import { useTranslations } from "next-intl";
import { Plus, Upload } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

// The warm welcome band at the top of /dashboard. Three things live here:
// a personalized greeting, a one-line status that surfaces the firm's
// "needs attention" count, and the two primary entry points (start a new
// engagement, import clients). The decorative glow is purely ornamental
// and hidden on small screens so mobile stays tidy.
export function DashboardHeader({
  firstName,
  attentionCount,
}: {
  firstName: string | null;
  attentionCount: number;
}) {
  const t = useTranslations("Dashboard");
  const tEng = useTranslations("Engagements");
  const tClients = useTranslations("Clients");

  // Fall back to a friendly "there" / "vous" when we don't know the name,
  // so the greeting never renders an empty slot.
  const name = firstName ?? t("welcome_there");
  const subtitle =
    attentionCount > 0
      ? t("attention_status", { count: attentionCount })
      : t("all_clear");

  return (
    <header className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.06] via-background to-background px-6 py-7 sm:px-8 sm:py-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-24 hidden h-56 w-56 rounded-full bg-primary/10 blur-3xl md:block"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-12 top-10 hidden h-28 w-28 rounded-full bg-primary/[0.07] blur-2xl md:block"
      />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {t("welcome_name", { name })}
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            {subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button asChild>
            <Link href="/engagements/new">
              <Plus className="h-4 w-4" />
              {tEng("new")}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/clients/import">
              <Upload className="h-4 w-4" />
              {tClients("import_title")}
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
