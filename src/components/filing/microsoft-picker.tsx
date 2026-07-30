"use client";

// The Microsoft destination picker: after OAuth, the owner chooses WHERE
// Vylan files — their OneDrive, or a SharePoint site's document library.
// Renders the "Choose where to file" button on the card and the two-step
// dialog behind it; auto-opens when the OAuth callback lands with
// ?microsoft=choose. Choosing creates the "Vylan" root folder in the picked
// drive and completes the connection.

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Building2, ChevronRight, HardDrive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  chooseMicrosoftDestinationAction,
  listMicrosoftDestinationsAction,
  listMicrosoftSiteLibrariesAction,
} from "@/app/actions/filing";
import type {
  MicrosoftDestinationList,
  MicrosoftLibrary,
} from "@/lib/filing/connectors/microsoft";

export function MicrosoftDestinationPicker() {
  const t = useTranslations("Filing");
  const router = useRouter();
  const params = useSearchParams();
  const autoOpened = useRef(false);

  const [open, setOpen] = useState(false);
  const [destinations, setDestinations] =
    useState<MicrosoftDestinationList | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Second step: the picked site whose libraries are being listed.
  const [siteStep, setSiteStep] = useState<{
    siteId: string;
    name: string;
    libraries: MicrosoftLibrary[] | null;
  } | null>(null);
  const [choosing, startChoosing] = useTransition();

  const load = useCallback(async () => {
    setLoadError(false);
    setDestinations(null);
    const result = await listMicrosoftDestinationsAction();
    if (result.ok) setDestinations(result.destinations);
    else setLoadError(true);
  }, []);

  // The OAuth callback's cue: land with ?microsoft=choose -> open the picker
  // immediately, once, and clean the URL.
  useEffect(() => {
    if (params.get("microsoft") === "choose" && !autoOpened.current) {
      autoOpened.current = true;
      setOpen(true);
      void load();
      router.replace("/files?tab=settings", { scroll: false });
    }
  }, [params, router, load]);

  function openPicker() {
    setOpen(true);
    setSiteStep(null);
    void load();
  }

  function choose(driveId: string, label: string) {
    startChoosing(async () => {
      const result = await chooseMicrosoftDestinationAction({ driveId, label });
      if (result.ok) {
        setOpen(false);
        toast.success(t("picker_chosen_toast"));
        router.refresh();
      } else {
        toast.error(t("toast_error_generic"));
      }
    });
  }

  async function pickSite(siteId: string, name: string) {
    setSiteStep({ siteId, name, libraries: null });
    const result = await listMicrosoftSiteLibrariesAction(siteId);
    if (!result.ok) {
      setSiteStep(null);
      toast.error(t("toast_error_generic"));
      return;
    }
    if (result.libraries.length === 1) {
      // One document library (the overwhelmingly common case): pick it.
      choose(result.libraries[0].driveId, `${name} · ${result.libraries[0].name}`);
      return;
    }
    setSiteStep({ siteId, name, libraries: result.libraries });
  }

  const rowClass =
    "flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-3.5 py-3 text-left text-sm transition-colors hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

  return (
    <>
      <Button size="sm" onClick={openPicker}>
        {t("choose_destination")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {siteStep?.libraries
                ? t("picker_libraries_title", { site: siteStep.name })
                : t("picker_title")}
            </DialogTitle>
            <DialogDescription>{t("picker_body")}</DialogDescription>
          </DialogHeader>

          {choosing || (!destinations && !loadError) ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("picker_loading")}
            </div>
          ) : loadError ? (
            <div className="space-y-3 py-4">
              <p className="text-sm text-muted-foreground">{t("picker_failed")}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t("picker_retry")}
              </Button>
            </div>
          ) : siteStep?.libraries ? (
            <div className="space-y-2">
              {siteStep.libraries.map((lib) => (
                <button
                  key={lib.driveId}
                  type="button"
                  className={rowClass}
                  disabled={choosing}
                  onClick={() => choose(lib.driveId, `${siteStep.name} · ${lib.name}`)}
                >
                  <HardDrive className="size-4 shrink-0 text-icon-blue" aria-hidden />
                  <span className="flex-1 truncate font-medium">{lib.name}</span>
                  <ChevronRight
                    className="size-4 text-muted-foreground/60"
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {destinations?.onedrive && (
                <button
                  type="button"
                  className={rowClass}
                  disabled={choosing}
                  onClick={() =>
                    choose(destinations.onedrive!.driveId, "OneDrive")
                  }
                >
                  <HardDrive className="size-4 shrink-0 text-icon-blue" aria-hidden />
                  <span className="flex-1 truncate font-medium">OneDrive</span>
                  <ChevronRight
                    className="size-4 text-muted-foreground/60"
                    aria-hidden
                  />
                </button>
              )}
              {(destinations?.sites.length ?? 0) > 0 && (
                <p className="pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("picker_sites_label")}
                </p>
              )}
              {destinations?.sites.map((site) => (
                <button
                  key={site.siteId}
                  type="button"
                  className={rowClass}
                  disabled={choosing}
                  onClick={() => void pickSite(site.siteId, site.name)}
                >
                  <Building2 className="size-4 shrink-0 text-icon-purple" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{site.name}</span>
                    {site.webUrl && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {site.webUrl.replace(/^https?:\/\//, "")}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    className="size-4 text-muted-foreground/60"
                    aria-hidden
                  />
                </button>
              ))}
              {!destinations?.onedrive &&
                (destinations?.sites.length ?? 0) === 0 && (
                  <p className="py-2 text-sm text-muted-foreground">
                    {t("picker_no_destinations")}
                  </p>
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
