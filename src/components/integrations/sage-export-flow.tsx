"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  ChevronsUpDown,
  Download,
  AlertTriangle,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getSageEngagementPreview } from "@/app/actions/sage-export";
import type {
  SagePreview,
  SageSkipReason,
} from "@/lib/integrations/sage-export";

export type SageEngagementOption = {
  id: string;
  title: string;
  clientName: string;
};

// The Sage export flow: pick one of the firm's engagements, then see an HONEST
// preview of what a CSV would contain — included vs skipped (with reasons) and
// any low-confidence reads to check — BEFORE any file is generated. The download
// itself is wired in Phase 4 (it needs the per-firm document reading turned on),
// so the button is present but disabled here.
export function SageExportFlow({
  engagements,
}: {
  engagements: SageEngagementOption[];
}) {
  const t = useTranslations("Integrations");
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<SagePreview | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  const selected = engagements.find((e) => e.id === selectedId) ?? null;
  const reasonText = (r: SageSkipReason) =>
    r === "statement" ? t("reason_statement") : t("reason_not_transaction");

  const pick = (id: string) => {
    setOpen(false);
    setSelectedId(id);
    setPreview(null);
    setError(false);
    startTransition(async () => {
      try {
        const p = await getSageEngagementPreview(id);
        if (p) setPreview(p);
        else setError(true);
      } catch {
        setError(true);
      }
    });
  };

  return (
    <div className="mt-12 border-t border-border/40 pt-8">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
        {t("flow_label")}
      </p>

      {engagements.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {t("flow_no_engagements")}
        </p>
      ) : (
        <div className="mt-4 max-w-md">
          <label
            htmlFor="sage-engagement-picker"
            className="text-sm font-medium"
          >
            {t("flow_pick_label")}
          </label>
          <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
              <Button
                id="sage-engagement-picker"
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="mt-1.5 h-10 w-full justify-between font-normal"
              >
                <span
                  className={cn("truncate", !selected && "text-muted-foreground")}
                >
                  {selected
                    ? `${selected.title} · ${selected.clientName}`
                    : t("flow_pick_trigger")}
                </span>
                <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[--radix-popover-trigger-width] p-0"
              align="start"
            >
              <Command>
                <CommandInput placeholder={t("flow_pick_placeholder")} />
                <CommandList>
                  <CommandEmpty>{t("flow_pick_empty")}</CommandEmpty>
                  {engagements.map((e) => (
                    <CommandItem
                      key={e.id}
                      value={`${e.title} ${e.clientName}`}
                      onSelect={() => pick(e.id)}
                      className="gap-2"
                    >
                      <Check
                        className={cn(
                          "size-4 shrink-0",
                          selectedId === e.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{e.title}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {e.clientName}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {pending && (
        <p className="mt-6 text-sm text-muted-foreground">
          {t("preview_loading")}
        </p>
      )}
      {error && !pending && (
        <p className="mt-6 text-sm text-destructive">{t("preview_error")}</p>
      )}
      {preview && !pending && (
        <PreviewView preview={preview} reasonText={reasonText} t={t} />
      )}
    </div>
  );
}

function PreviewView({
  preview,
  reasonText,
  t,
}: {
  preview: SagePreview;
  reasonText: (r: SageSkipReason) => string;
  t: ReturnType<typeof useTranslations>;
}) {
  const skipped = preview.docs.filter(
    (d): d is Extract<SagePreview["docs"][number], { status: "skipped" }> =>
      d.status === "skipped",
  );
  const lowConf = preview.docs.filter(
    (d) => d.status === "included" && d.lowConfidence,
  );
  const SKIP_CAP = 8;

  // Empty state: nothing exportable. Say so plainly instead of implying a file.
  if (preview.includedCount === 0) {
    return (
      <div className="mt-6 max-w-md rounded-xl border border-border/50 bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <Inbox className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <div className="text-sm font-medium">{t("preview_none_title")}</div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("preview_none_body")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 max-w-md space-y-4">
      {/* Headline count. */}
      <div className="rounded-xl border border-border/50 bg-card/40 p-4">
        <p className="text-sm">
          {t("preview_headline", {
            included: preview.includedCount,
            total: preview.total,
          })}
        </p>

        {/* Low-confidence reads to check. */}
        {lowConf.length > 0 && (
          <div className="mt-3 rounded-lg border border-warning/30 bg-warning/[0.06] p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-warning">
              <AlertTriangle className="size-3.5 shrink-0" />
              {t("preview_lowconf_title")}
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {lowConf.map((d) => (
                <li
                  key={d.id}
                  className="truncate text-xs text-muted-foreground"
                >
                  {d.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Skipped documents, listed with their reason. */}
      {skipped.length > 0 && (
        <div>
          <div className="px-1 text-xs font-medium text-muted-foreground">
            {t("preview_skipped_label")} ({skipped.length})
          </div>
          <ul className="mt-1.5 space-y-1">
            {skipped.slice(0, SKIP_CAP).map((d) => (
              <li
                key={d.id}
                className="flex items-baseline justify-between gap-3 rounded-md px-1 py-1 text-xs"
              >
                <span className="truncate text-foreground/80">{d.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {reasonText(d.reason)}
                </span>
              </li>
            ))}
          </ul>
          {skipped.length > SKIP_CAP && (
            <p className="mt-1 px-1 text-xs text-muted-foreground/70">
              {t("preview_skipped_more", { count: skipped.length - SKIP_CAP })}
            </p>
          )}
        </div>
      )}

      {/* Download — wired in Phase 4 (needs the per-firm reading turned on). */}
      <div className="pt-1">
        <Button type="button" disabled className="gap-2">
          <Download className="size-4" />
          {t("download_cta")}
        </Button>
        <p className="mt-1.5 text-xs text-muted-foreground/70">
          {t("download_soon")}
        </p>
      </div>
    </div>
  );
}
