// The four storage-provider connect cards on the Document filing page.
//
// Google Drive is LIVE (Phase 2): connect via OAuth, connected state with the
// account + root-folder link, reconnect on error, disconnect with confirm.
// Microsoft and Dropbox ship in later phases; SmartVault additionally pends
// their API-access confirmation and reads "Coming soon".

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
  GoogleConnectButton,
  GoogleDisconnectButton,
} from "./google-card-actions";

const PROVIDERS: Array<{
  key: StorageProvider;
  logo: ReactNode;
  tileClassName: string;
  // live = has a working connector; the rest show why they can't connect yet.
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
    state: "next_update",
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

export async function ProviderGrid({
  connection,
  rootLink,
  isOwner,
  googleConfigured,
}: {
  connection: StorageConnectionDisplay | null;
  // Link out to the connected provider's root folder (service-role display
  // read; null when not connected or the provider returned none).
  rootLink: string | null;
  isOwner: boolean;
  // Google credentials (and, in production, the token-encryption key) are in
  // place on this deployment. False renders the card in a setup-pending state
  // instead of an enabled button that can only error.
  googleConfigured: boolean;
}) {
  const t = await getTranslations("Filing");

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {PROVIDERS.map((p) => {
        const isThis = connection?.provider === p.key;
        const connected = isThis && connection.status === "active";
        const needsReconnect = isThis && connection.status === "error";
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
                    : needsReconnect
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
              {connected && rootLink && (
                <a
                  href={rootLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 pt-0.5 text-xs font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
                >
                  {t("open_folder")}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              {p.state === "live" ? (
                !googleConfigured && !connected ? (
                  <>
                    <Button variant="outline" size="sm" disabled>
                      {t("action_connect")}
                    </Button>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {t("toast_error_not_configured")}
                    </p>
                  </>
                ) : isOwner ? (
                  <div className="flex items-center gap-2">
                    {connected ? (
                      <GoogleDisconnectButton />
                    ) : (
                      <GoogleConnectButton
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
          </div>
        );
      })}
    </div>
  );
}
