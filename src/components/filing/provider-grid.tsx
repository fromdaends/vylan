// The four storage-provider connect cards on the Document filing page.
//
// Phase 1: presentational only — every connector ships in a later phase, so
// the buttons are disabled with an explanatory hint (SmartVault additionally
// pends their API-access confirmation and reads "Coming soon"). The card
// layout, badges, and state plumbing are final so later phases only flip the
// action.

import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { StorageConnectionDisplay } from "@/lib/db/filing";
import type { StorageProvider } from "@/lib/filing/types";
import {
  DropboxLogo,
  GoogleDriveLogo,
  MicrosoftLogo,
  SmartVaultLogo,
} from "./provider-logos";

const PROVIDERS: Array<{
  key: StorageProvider;
  logo: ReactNode;
  tileClassName: string;
  // Connectors that exist yet. none do in Phase 1; SmartVault additionally
  // awaits API-access confirmation and shows "Coming soon" instead of the
  // next-update hint.
  pending: "next_update" | "coming_soon";
}> = [
  {
    key: "google_drive",
    logo: <GoogleDriveLogo className="h-7 w-7" />,
    tileClassName: "bg-[#0066DA]/10 ring-[#0066DA]/20",
    pending: "next_update",
  },
  {
    key: "microsoft",
    logo: <MicrosoftLogo className="h-6 w-6" />,
    tileClassName: "bg-[#00A4EF]/10 ring-[#00A4EF]/20",
    pending: "next_update",
  },
  {
    key: "dropbox",
    logo: <DropboxLogo className="h-7 w-7" />,
    tileClassName: "bg-[#0061FF]/10 ring-[#0061FF]/20",
    pending: "next_update",
  },
  {
    key: "smartvault",
    logo: <SmartVaultLogo className="h-7 w-7" />,
    tileClassName: "bg-[#1F3B63]/10 ring-[#1F3B63]/25",
    pending: "coming_soon",
  },
];

export async function ProviderGrid({
  connection,
}: {
  connection: StorageConnectionDisplay | null;
}) {
  const t = await getTranslations("Filing");

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {PROVIDERS.map((p) => {
        const connected = connection?.provider === p.key;
        return (
          <div
            key={p.key}
            className="flex flex-col rounded-2xl border border-border/60 bg-card/40 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <span
                className={cn(
                  "inline-flex h-12 w-12 items-center justify-center rounded-xl ring-1 ring-inset",
                  p.tileClassName,
                )}
              >
                {p.logo}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                  connected
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-secondary text-muted-foreground",
                )}
              >
                {connected && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                    aria-hidden
                  />
                )}
                {connected
                  ? t("state_connected")
                  : p.pending === "coming_soon"
                    ? t("state_coming_soon")
                    : t("state_not_connected")}
              </span>
            </div>

            <div className="mt-4 space-y-1">
              <h3 className="text-base font-semibold tracking-tight">
                {t(`provider_${p.key}_name`)}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t(`provider_${p.key}_desc`)}
              </p>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <Button variant="outline" size="sm" disabled>
                {t("action_connect")}
              </Button>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {p.pending === "coming_soon"
                  ? t("hint_coming_soon")
                  : t("hint_next_update")}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
