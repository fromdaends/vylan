"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Upload, Check, FileCheck2, X, RotateCcw, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { RequestItem, RequestItemStatus } from "@/lib/db/request-items";

// Shape returned by /api/portal/upload-status once the background classifier
// has written its verdict to the uploaded_files row.
type UploadVerdict = {
  usable: boolean;
  primary_issue: string | null;
  issue_summary_fr: string;
  issue_summary_en: string;
  auto_rejected: boolean;
};

const ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";

// AI runs in the background after the upload response. Poll for up to
// ~30s so even slow PDFs surface the verdict inline. If the AI takes
// longer (rare), the cron + retry email pick it up.
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30_000;

export function ItemCard({
  token,
  item,
  locale,
  uploadedCount,
  rejection,
  onUploaded,
  onStatusChange,
}: {
  token: string;
  item: RequestItem;
  locale: "fr" | "en";
  uploadedCount: number;
  // Bilingual AI rejection summary for this item (from the latest upload's
  // usability verdict). Lets the re-upload banner follow the language toggle
  // instead of being stuck in the single language `item.rejection_reason` was
  // written in. Null for manual / legacy rejections — those fall back to the
  // column text.
  rejection: { fr: string; en: string } | null;
  onUploaded: () => void;
  onStatusChange: (s: RequestItemStatus) => void;
}) {
  const t = useTranslations("Portal");
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Surfaced when the background AI classifier flagged the upload as the
  // wrong document or otherwise unusable. Lets the client retry without
  // having to wait for the email/SMS.
  const [aiRejection, setAiRejection] = useState<string | null>(null);
  // True while we're polling /api/portal/upload-status for the latest
  // upload's verdict. Shows a small "Checking…" hint so the client knows
  // the document is being reviewed (without making them wait on the
  // upload itself).
  const [checking, setChecking] = useState(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  const [pendingNa, startNa] = useTransition();
  // Drag-and-drop a file straight onto the card (desktop nicety; the Upload
  // button is the primary path and works everywhere).
  const [dragging, setDragging] = useState(false);

  // Cancel any in-flight poll when the component unmounts.
  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  async function pollVerdict(fileId: string): Promise<void> {
    pollAbortRef.current?.abort();
    const ctl = new AbortController();
    pollAbortRef.current = ctl;
    setChecking(true);
    const startedAt = Date.now();
    try {
      while (!ctl.signal.aborted) {
        if (Date.now() - startedAt >= POLL_TIMEOUT_MS) break;
        try {
          const res = await fetch("/api/portal/upload-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token,
              item_id: item.id,
              file_id: fileId,
            }),
            signal: ctl.signal,
          });
          if (res.ok) {
            const body = (await res.json().catch(() => null)) as {
              status?: "pending" | "done";
              verdict?: UploadVerdict | null;
            } | null;
            if (body?.status === "done") {
              if (body.verdict?.auto_rejected) {
                const msg =
                  locale === "fr"
                    ? body.verdict.issue_summary_fr ||
                      body.verdict.issue_summary_en
                    : body.verdict.issue_summary_en ||
                      body.verdict.issue_summary_fr;
                setAiRejection(msg || t("ai_rejected_generic"));
              }
              break;
            }
          }
          // Non-OK responses (404 on a deleted file, 429 on rate limit,
          // etc.) just abort the poll silently — the email/SMS fallback
          // still works.
          else if (res.status === 404 || res.status === 429) {
            break;
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          // Network blip — wait and retry until timeout.
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    } finally {
      if (!ctl.signal.aborted) setChecking(false);
    }
  }

  const label =
    locale === "fr" && item.label_fr ? item.label_fr : item.label;
  const description =
    locale === "fr" && item.description_fr
      ? item.description_fr
      : item.description;

  async function uploadFiles(files: FileList) {
    setError(null);
    setAiRejection(null);
    // Cancel any prior poll — the new upload is what we care about now.
    pollAbortRef.current?.abort();
    setChecking(false);
    for (const file of Array.from(files)) {
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("token", token);
        fd.append("item_id", item.id);
        fd.append("file", file);
        const res = await fetch("/api/portal/upload", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(j?.error ?? "upload_failed");
        }
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          file_id?: string;
        } | null;
        // Always count the upload — the file IS saved server-side. The
        // verdict only governs whether we surface a "try again" message
        // on top of that.
        onUploaded();
        // Kick off polling for the AI verdict. We don't await it — the
        // user gets immediate "upload complete" feedback and the verdict
        // banner (if any) appears within a few seconds. Polling is
        // cancelled if a new upload starts or the component unmounts.
        if (typeof body?.file_id === "string") {
          void pollVerdict(body.file_id);
        }
      } catch (e) {
        setError((e as Error).message);
        break;
      } finally {
        setUploading(false);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function markNa() {
    startNa(async () => {
      const res = await fetch("/api/portal/mark-na", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, item_id: item.id }),
      });
      if (res.ok) onStatusChange("na");
      else setError("mark_na_failed");
    });
  }

  function undoNa() {
    startNa(async () => {
      const res = await fetch("/api/portal/undo-na", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, item_id: item.id }),
      });
      if (res.ok) onStatusChange(uploadedCount > 0 ? "submitted" : "pending");
      else setError("undo_failed");
    });
  }

  const canUpload = item.status !== "na";

  // Single rejection banner, two sources in priority order:
  //   1. `aiRejection` — set during the current upload turn so the client sees
  //      the verdict the instant the API replies, before the page refetches.
  //   2. `item.rejection_reason` — the persistent server column that survives a
  //      reload. The upload route clears it on every new upload, so it never
  //      goes stale across attempts.
  const reasonSet =
    item.rejection_reason != null && item.rejection_reason.trim() !== "";
  const bannerMsg =
    aiRejection ??
    (!reasonSet
      ? null
      : rejection
        ? locale === "fr"
          ? rejection.fr
          : rejection.en
        : item.rejection_reason!.trim());
  const hasIssue = item.status === "rejected" || bannerMsg !== null;

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  }

  return (
    <div
      onDragOver={
        canUpload
          ? (e) => {
              e.preventDefault();
              setDragging(true);
            }
          : undefined
      }
      onDragLeave={canUpload ? () => setDragging(false) : undefined}
      onDrop={canUpload ? onDrop : undefined}
      className={cn(
        "group rounded-xl border p-4 transition-all duration-200 sm:p-5",
        dragging
          ? "border-accent bg-accent/[0.05] ring-2 ring-accent/25"
          : item.status === "submitted" || item.status === "approved"
            ? "border-success/30 bg-success/[0.04]"
            : item.status === "na"
              ? "border-border/60 bg-muted/30"
              : "border-border/60 bg-card/40 hover:border-border hover:bg-card hover:shadow-sm",
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <StatusIcon status={item.status} hasIssue={hasIssue} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[15px] font-medium leading-snug text-foreground">
                {label}
                {item.required && (
                  <span
                    className="ml-1 align-middle text-warning"
                    aria-label={t("required")}
                    title={t("required")}
                  >
                    *
                  </span>
                )}
              </h3>
              {description && (
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            <StatusBadge status={item.status} uploadedCount={uploadedCount} />
          </div>

          {bannerMsg && (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2.5 text-sm">
              <div className="flex items-center gap-1.5 font-medium text-warning">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                {item.status === "rejected"
                  ? t("rejected_action_needed")
                  : t("ai_rejected_title")}
              </div>
              <p className="mt-1 text-foreground/80">{bannerMsg}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("ai_rejected_help")}
              </p>
            </div>
          )}

          {error && <ErrorLine error={error} />}

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {item.status === "na" ? (
              <Button variant="outline" size="sm" onClick={undoNa} disabled={pendingNa}>
                <RotateCcw className="size-4" />
                {t("undo_na")}
              </Button>
            ) : (
              <>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT}
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      uploadFiles(e.target.files);
                    }
                  }}
                />
                <Button
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                  variant={uploadedCount > 0 ? "outline" : "default"}
                >
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Upload className="size-4" aria-hidden />
                  )}
                  {uploading
                    ? t("uploading")
                    : uploadedCount > 0
                      ? t("add_more")
                      : t("upload")}
                </Button>
                {!item.required && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={markNa}
                    disabled={pendingNa || uploading}
                  >
                    <X className="size-4" />
                    {t("mark_na")}
                  </Button>
                )}
              </>
            )}
            {uploadedCount > 0 && item.status !== "na" && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <FileCheck2 className="size-3.5" />
                {t("uploaded_count", { count: uploadedCount })}
              </span>
            )}
            {checking && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                aria-live="polite"
              >
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {t("checking_document")}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorLine({ error }: { error: string }) {
  const t = useTranslations("Portal");
  const key = `errors.${error}` as const;
  const message =
    typeof (t as unknown as { has?: (k: string) => boolean }).has === "function"
      ? (t as unknown as { has: (k: string) => boolean }).has(key)
        ? t(key)
        : error
      : error;
  return <p className="text-xs text-destructive mt-2">{message}</p>;
}

function StatusIcon({
  status,
  hasIssue,
}: {
  status: RequestItemStatus;
  hasIssue: boolean;
}) {
  const ring =
    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full";
  if (hasIssue) {
    return (
      <span className={cn(ring, "bg-warning/15 text-warning")}>
        <AlertTriangle className="size-3.5" aria-hidden />
      </span>
    );
  }
  if (status === "approved") {
    return (
      <span className={cn(ring, "bg-success text-white")}>
        <Check className="size-3.5" aria-hidden />
      </span>
    );
  }
  if (status === "submitted") {
    return (
      <span className={cn(ring, "bg-accent text-white")}>
        <Check className="size-3.5" aria-hidden />
      </span>
    );
  }
  if (status === "na") {
    return (
      <span className={cn(ring, "border-2 border-muted-foreground/20 text-muted-foreground")}>
        <X className="size-3" aria-hidden />
      </span>
    );
  }
  // pending — hollow ring
  return (
    <span
      className="mt-0.5 size-6 shrink-0 rounded-full border-2 border-muted-foreground/25"
      aria-hidden
    />
  );
}

function StatusBadge({
  status,
  uploadedCount,
}: {
  status: RequestItemStatus;
  uploadedCount: number;
}) {
  const t = useTranslations("Portal");
  const base =
    "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  if (status === "approved")
    return (
      <span className={cn(base, "bg-success/15 text-success")}>
        {t("status_approved")}
      </span>
    );
  if (status === "submitted")
    return (
      <span className={cn(base, "bg-accent/15 text-accent")}>
        {t("status_submitted", { count: uploadedCount })}
      </span>
    );
  // No "rejected" pill: the amber status icon + the re-upload banner carry it,
  // and the full string would crowd the title on a phone.
  if (status === "na")
    return (
      <span className={cn(base, "bg-muted text-muted-foreground")}>
        {t("status_na")}
      </span>
    );
  return null;
}
