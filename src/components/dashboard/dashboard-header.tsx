"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { DashboardGreeting } from "@/components/dashboard/dashboard-greeting";

// The welcome band at the top of /dashboard. No card chrome — the time-aware
// greeting sits flush on the page (left) and the secondary entry points (import
// clients, the What's-new bell) stay on the right, so the header reads as part
// of the page rather than a boxed-off panel.
//
// "New engagement" is deliberately NOT here: the icon rail's "+" is the one
// primary entry point now, and having both was two buttons for one action.
export function DashboardHeader({
  firstName,
  subtitle,
  bell,
}: {
  firstName: string | null;
  // Static subtitle part (the firm name); the greeting appends today's date
  // from the USER's clock client-side (not the server's UTC "today").
  subtitle: string;
  // The What's-new bell + anchored popover (server-rendered feed inside a client
  // shell), passed from the page so this header stays presentation-only.
  bell?: ReactNode;
}) {
  const tClients = useTranslations("Clients");

  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <DashboardGreeting
        firstName={firstName}
        subtitle={subtitle}
        showLocalDate
      />

      <div className="flex flex-wrap items-center gap-2.5">
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
