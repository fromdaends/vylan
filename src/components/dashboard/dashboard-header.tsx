"use client";

import { useTranslations } from "next-intl";
import { Plus, Upload } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { DashboardGreeting } from "@/components/dashboard/dashboard-greeting";

// The welcome band at the top of /dashboard (now the landing page). The
// time-aware greeting (moved here from the old Home page) sits on the left;
// the two primary entry points — start a new engagement, import clients —
// stay on the right. The decorative glow is purely ornamental and hidden on
// small screens so mobile stays tidy.
export function DashboardHeader({
  firstName,
  subtitle,
}: {
  firstName: string | null;
  subtitle: string;
}) {
  const tEng = useTranslations("Engagements");
  const tClients = useTranslations("Clients");

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
        <DashboardGreeting firstName={firstName} subtitle={subtitle} />

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
