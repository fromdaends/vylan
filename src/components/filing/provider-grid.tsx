// The four storage-provider connect cards on the Document filing page.
//
// Google Drive (Phase 2) and Microsoft SharePoint/OneDrive (Phase 3) are
// LIVE. Microsoft's extra beat: after OAuth the owner must CHOOSE where to
// file (OneDrive or a SharePoint library) — until then the card shows the
// "Choose where to file" state (root_label null is that state's marker).
// Dropbox ships later; SmartVault pends their API-access confirmation.

import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { ExternalLink } from "lucide-react";
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
import {
  ProviderConnectButton,
  ProviderDisconnectButton,
} from "./provider-card-actions";
import { MicrosoftDestinationPicker } from "./microsoft-picker";

const PROVIDERS: Array<{
  key: StorageProvider;
  logo: ReactNode;
  tileClassName: string;
  state: "live" | "next_update" | "coming_soon";
}> = [
  {
    key: "google_drive",
    logo: <GoogleDriveLogo className="h-7 w-7" />,
    tileClassName: "bg-[#0066DA]/10 ring-[#0066DA]/20",
    state: "live",
  },
  {
    key: "microsoft",
    logo: <MicrosoftLogo className="h-6 w-6" />,
    tileClassName: "bg-[#00A4EF]/10 ring-[#00A4EF]/20",
    state: "live",
  },
  {
    key: "dropbox",
    logo: <DropboxLogo className="h-7 w-7" />,
    tileClassName: "bg-[#0061FF]/10 ring-[#0061FF]/20",
    state: "next_update",
  },
  {
    key: "smartvault",
    logo: <SmartVaultLogo className="h-7 w-7" />,
    tileClassName: "bg-[#1F3B63]/10 ring-[#1F3B63]/25",
    state: "coming_soon",
  },
];

// Per-provider wiring for the LIVE cards.
const LIVE: Record<
  "google_drive" | "microsoft",
  { connectEndpoint: string; disconnectEndpoint: string; displayName: string }
> = {
  google_drive: {
    connectEndpoint: "/api/integrations/filing/google/connect",
    disconnectEndpoint: "/api/integrations/filing/google/disconnect",
    displayName: "Google Drive",
  },
  microsoft: {
    connectEndpoint: "/api/integrations/filing/microsoft/connect",
    disconnectEndpoint: "/api/integrations/filing/microsoft/disconnect",
    displayName: "SharePoint / OneDrive",
  },
};

export async function ProviderGrid({
  connection,
  rootLink,
  isOwner,
  configured,
}: {
  connection: StorageConnectionDisplay | null;
  // Link out to the connected provider's root folder (service-role display
  // read; null when not connected or no destination chosen yet).
  rootLink: string | null;
  isOwner: boolean;
  // Which live providers have credentials on this deployment (and, in
  // production, the token-encryption key). Unconfigured = disabled button +
  // plain note instead of a button that can only error.
  configured: { google_drive: boolean; microsoft: boolean };
}) {
  const t = await getTranslations("Filing");

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {PROVIDERS.map((p) => {
        const isThis = connection?.provider === p.key;
        const active = isThis && connection.status === "active";
        const needsReconnect = isThis && connection.status === "error";
        // Microsoft between OAuth and the destination pick.
        const needsDestination =
          active && p.key === "microsoft" && !connection.rootLabel;
        const connected = active && !needsDestination;
        const live = p.state === "live" ? LIVE[p.key as "google_drive"] : null;
        const isConfigured =
          p.key === "google_drive" || p.key === "microsoft"
            ? configured[p.key]
            : false;

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
                    : needsReconnect || needsDestination
                      ? "bg-warning/15 text-warning"
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
                  : needsDestination
                    ? t("state_action_needed")
                    : needsReconnect
                      ? t("state_reconnect")
                      : p.state === "coming_soon"
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
              {isThis && connection.accountLabel && (
                <p className="pt-1 text-xs text-muted-foreground">
                  {t("connected_as", { email: connection.accountLabel })}
                </p>
              )}
              {/* Where filing lands: "OneDrive · Vylan" / "Site · Documents ·
                  Vylan" (Microsoft) — Google's is always just "Vylan". */}
              {connected && p.key === "microsoft" && connection.rootLabel && (
                <p className="text-xs text-muted-foreground">
                  {connection.rootLabel}
                </p>
              )}
              {connected && rootLink && (
                <a
                  href={rootLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 pt-0.5 text-xs font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
                >
                  {p.key === "google_drive"
                    ? t("open_folder")
                    : t("open_folder_ms")}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              {live ? (
                !isConfigured && !active && !needsReconnect ? (
                  <>
                    <Button variant="outline" size="sm" disabled>
                      {t("action_connect")}
                    </Button>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {t("toast_error_not_configured")}
                    </p>
                  </>
                ) : isOwner ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {needsDestination && <MicrosoftDestinationPicker />}
                    {(connected || needsDestination) && (
                      <ProviderDisconnectButton
                        endpoint={live.disconnectEndpoint}
                        providerName={live.displayName}
                      />
                    )}
                    {!active && (
                      <ProviderConnectButton
                        endpoint={live.connectEndpoint}
                        label={
                          needsReconnect
                            ? t("action_reconnect")
                            : t("action_connect")
                        }
                      />
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {t("owner_only_note")}
                  </p>
                )
              ) : (
                <>
                  <Button variant="outline" size="sm" disabled>
                    {t("action_connect")}
                  </Button>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {p.state === "coming_soon"
                      ? t("hint_coming_soon")
                      : t("hint_next_update")}
                  </p>
                </>
              )}
            </div>

            {/* Microsoft-only honesty note: some workplaces make an IT admin
                approve new apps before staff can connect. */}
            {p.key === "microsoft" && !connected && (
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                {t("hint_admin_consent")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
