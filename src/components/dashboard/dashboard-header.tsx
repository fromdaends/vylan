"use client";

import type { ReactNode } from "react";
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
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      {/* No date here anymore — it moved into the agenda card (design 2a),
          where "what day is it" sits beside "what is my day". */}
      <DashboardGreeting firstName={firstName} subtitle={subtitle} />

      {/* Just the bell. "Import clients" left this header on the founder's
          call (2026-08-03): importing is a clients-section job, not something
          the Overview needs a standing button for. */}
      <div className="flex flex-wrap items-center gap-2.5">{bell}</div>
    </header>
  );
}
