"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Plus, Upload } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { DashboardGreeting } from "@/components/dashboard/dashboard-greeting";

// The welcome band at the top of /dashboard. No card chrome — the time-aware
// greeting sits flush on the page (left) and the primary entry points —
// start a new engagement, import clients, the What's-new bell — stay on the
// right, so the header reads as part of the page rather than a boxed-off
// panel.
export function DashboardHeader({
  firstName,
  subtitle,
  bell,
}: {
  firstName: string | null;
  // Static subtitle part (the firm name); the greeting appends today's date
  // from the USER's clock client-side (not the server's UTC "today").
  subtitle: string;
  // The What's-new bell + slide-out (server-rendered feed inside a client
  // shell), passed from the page so this header stays presentation-only.
  bell?: ReactNode;
}) {
  const tEng = useTranslations("Engagements");
  const tClients = useTranslations("Clients");

  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <DashboardGreeting
        firstName={firstName}
        subtitle={subtitle}
        showLocalDate
      />

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
        {bell}
      </div>
    </header>
  );
}
