"use client";

// The on-demand "File to storage" dialog (engagement "..." menu). Before the
// run: a plain statement of what will happen — how many approved documents,
// to which storage, what's excluded — and the per-engagement final-documents
// opt-in. After: the honest report — filed (with links out), skipped (with
// reasons), failed (with a Retry that only re-attempts failures; the ledger
// makes re-runs double-file-proof).

import { useCallback, useState, useTransition } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MinusCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getFilingStatusAction,
  runFilingAction,
  type FilingDialogStatus,
  type RunFilingActionResult,
} from "@/app/actions/filing";

export function FileToStorageDialog({
  engagementId,
  trigger,
}: {
  engagementId: string;
  trigger: React.ReactNode;
}) {
  const t = useTranslations("Filing");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<FilingDialogStatus | null>(null);
  const [finals, setFinals] = useState(false);
  const [result, setResult] = useState<RunFilingActionResult | null>(null);
  const [running, startRunning] = useTransition();

  const load = useCallback(async () => {
    setStatus(null);
    setResult(null);
    const s = await getFilingStatusAction(engagementId);
    setStatus(s);
    if (s.ok) setFinals(s.fileFinalDocuments);
  }, [engagementId]);

  function run() {
    startRunning(async () => {
      const r = await runFilingAction(engagementId, {
        fileFinalDocuments: finals,
      });
      setResult(r);
    });
  }

  const providerName =
    status?.ok && status.connection
      ? status.connection.provider === "google_drive"
        ? "Google Drive"
        : status.connection.provider === "microsoft"
          ? "SharePoint / OneDrive"
          : "Dropbox"
      : "";

  const toFile =
    status?.ok
      ? status.counts.approved + (finals ? status.counts.finals : 0)
      : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // Load fresh state on every open (no effect needed); drop stale
        // results on close so reopening starts at the summary.
        if (v) void load();
        else setResult(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("dialog_title")}</DialogTitle>
          <DialogDescription>{t("dialog_body")}</DialogDescription>
        </DialogHeader>

        {!status ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("dialog_loading")}
          </div>
        ) : !status.ok ? (
          <p className="py-4 text-sm text-muted-foreground">
            {t("toast_error_generic")}
          </p>
        ) : !status.available ? (
          <p className="py-4 text-sm text-muted-foreground">
            {t("unavailable_body")}
          </p>
        ) : !status.connection ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {t("dialog_not_connected")}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/integrations/filing">{t("dialog_go_connect")}</Link>
            </Button>
          </div>
        ) : status.connection.needsReconnect ||
          status.connection.needsDestination ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {status.connection.needsReconnect
                ? t("dialog_needs_reconnect", { provider: providerName })
                : t("dialog_needs_destination")}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/integrations/filing">{t("dialog_go_connect")}</Link>
            </Button>
          </div>
        ) : result ? (
          <FilingResultView result={result} onRetry={run} running={running} />
        ) : (
          <div className="space-y-4">
            {/* What will happen, in one sentence. */}
            <p className="text-sm leading-relaxed">
              {t("dialog_summary", {
                count: toFile,
                provider: providerName,
              })}
              {status.connection.rootLabel && (
                <span className="text-muted-foreground">
                  {" "}
                  ({status.connection.rootLabel})
                </span>
              )}
            </p>

            {/* The filter is the feature — say it. */}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("dialog_exclusions", {
                notApproved: status.counts.notApproved,
                rejected: status.counts.rejected + status.counts.duplicates,
              })}
            </p>

            {status.counts.finals > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="finals-optin">
                    {t("dialog_finals_label", { count: status.counts.finals })}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("dialog_finals_hint")}
                  </p>
                </div>
                <Switch
                  id="finals-optin"
                  checked={finals}
                  onCheckedChange={setFinals}
                />
              </div>
            )}

            {status.lastRun && (
              <p className="text-xs text-muted-foreground">
                {t("dialog_last_run", {
                  date: new Date(status.lastRun.at).toLocaleDateString(),
                  filed: status.lastRun.filed,
                  skipped: status.lastRun.skipped,
                  failed: status.lastRun.failed,
                })}
              </p>
            )}

            <DialogFooter>
              <Button onClick={run} disabled={running || toFile === 0}>
                {running && <Loader2 className="animate-spin" />}
                {toFile === 0
                  ? t("dialog_nothing_to_file")
                  : t("dialog_run", { count: toFile })}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FilingResultView({
  result,
  onRetry,
  running,
}: {
  result: RunFilingActionResult;
  onRetry: () => void;
  running: boolean;
}) {
  const t = useTranslations("Filing");

  if (!result.ok) {
    return (
      <div className="space-y-3 py-2">
        <p className="text-sm text-muted-foreground">
          {result.error === "run_failed"
            ? t("dialog_run_failed")
            : t("toast_error_generic")}
        </p>
        {result.error === "run_failed" && (
          <Button variant="outline" size="sm" onClick={onRetry} disabled={running}>
            {running && <Loader2 className="animate-spin" />}
            {t("dialog_retry")}
          </Button>
        )}
      </div>
    );
  }

  const filed = result.outcomes.filter((o) => o.status === "filed");
  const skipped = result.outcomes.filter((o) => o.status === "skipped");
  const failed = result.outcomes.filter((o) => o.status === "failed");

  return (
    <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
      <p className="text-sm font-medium">
        {t("result_headline", {
          filed: result.filed,
          skipped: result.skipped,
          failed: result.failed,
        })}
      </p>

      {filed.length > 0 && (
        <ResultGroup label={t("result_filed_label")}>
          {filed.map((o) =>
            o.status === "filed" ? (
              <li key={o.fileId} className="flex items-start gap-2 text-sm">
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-emerald-500"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{o.filedName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {o.folderPath}
                  </span>
                </span>
                {o.link && (
                  <a
                    href={o.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={t("result_open_file")}
                  >
                    <ExternalLink className="size-4" aria-hidden />
                  </a>
                )}
              </li>
            ) : null,
          )}
        </ResultGroup>
      )}

      {skipped.length > 0 && (
        <ResultGroup label={t("result_skipped_label")}>
          {skipped.map((o) =>
            o.status === "skipped" ? (
              <li key={o.fileId} className="flex items-start gap-2 text-sm">
                <MinusCircle
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground/70"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.displayName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`skip_${o.reason}`)}
                  </span>
                </span>
              </li>
            ) : null,
          )}
        </ResultGroup>
      )}

      {failed.length > 0 && (
        <ResultGroup label={t("result_failed_label")}>
          {failed.map((o) =>
            o.status === "failed" ? (
              <li key={o.fileId} className="flex items-start gap-2 text-sm">
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-warning"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.displayName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {o.error}
                  </span>
                </span>
              </li>
            ) : null,
          )}
        </ResultGroup>
      )}

      {failed.length > 0 && (
        <DialogFooter>
          <Button variant="outline" onClick={onRetry} disabled={running}>
            {running && <Loader2 className="animate-spin" />}
            {t("dialog_retry_failures", { count: failed.length })}
          </Button>
        </DialogFooter>
      )}
    </div>
  );
}

function ResultGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}
