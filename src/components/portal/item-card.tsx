"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Upload, Check, CheckCircle2, FileCheck2, FileText, X, RotateCcw, AlertTriangle, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { RequestItem, RequestItemStatus } from "@/lib/db/request-items";
import type { PortalFile } from "@/lib/db/portal";
import { PortalImageLightbox } from "./portal-image-lightbox";

// Shape returned by /api/portal/upload-status once the background classifier
// has written its verdict to the uploaded_files row.
type UploadVerdict = {
  usable: boolean;
  issue_summary_fr: string;
  issue_summary_en: string;
  auto_rejected: boolean;
  // The AI affirmatively recognised the upload as the requested document —
  // drives the green "received, looks right" note. Optional so a cached
  // pre-deploy server response (without the field) reads as not-confirmed.
  confirmed?: boolean;
};

// Machine-readable documents (Excel / CSV) are accepted too — the code-readable
// fast path reads them without the AI. Both the MIME types and the extensions
// are listed so the OS file picker offers them even when a browser reports a
// generic MIME for a spreadsheet.
const ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif," +
  "text/csv,application/vnd.ms-excel," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  ".csv,.xls,.xlsx";

// Mirrors the server's MAX_BYTES (lib/storage). Checked before any network
// round-trip so an oversize pick gets the translated "larger than 25 MB"
// message instantly instead of a doomed upload.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
// Part size for the chunked flow — mirrors UPLOAD_PART_BYTES in lib/storage
// (kept literal here: this is a client component and the server constant
// lives in a server module). Must stay comfortably under the platform's
// ~4.5 MB request cap including form-encoding overhead.
const UPLOAD_PART_BYTES = 3.5 * 1024 * 1024;

// Path-safe random id for one chunked upload (the server validates
// [A-Za-z0-9-]{8,40} and scopes it under this item's staging prefix).
function newUploadId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `u${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

type UploadResponse = { ok?: boolean; file_id?: string } | null;

// AI runs in the background after the upload response. The verdict usually
// lands in seconds, but when the immediate run fails (a transient error, a
// busy queue) the durable fallback is a cron that retries every 2 MINUTES —
// so a hard 30s poll cutoff meant the verdict sometimes appeared only after
// a manual page reload. Poll fast while it's likely quick, then back off and
// keep listening for up to 10 minutes (covers several cron retries) before
// going quiet. The schedule is exported as a pure function for tests.
const POLL_PHASES: { untilMs: number; intervalMs: number }[] = [
  { untilMs: 30_000, intervalMs: 1_500 },
  { untilMs: 2 * 60_000, intervalMs: 5_000 },
  { untilMs: 10 * 60_000, intervalMs: 15_000 },
];

// The wait before the next verdict poll given how long we've been polling,
// or null once it's time to give up (the email/SMS fallback covers the rest).
export function pollIntervalFor(elapsedMs: number): number | null {
  for (const phase of POLL_PHASES) {
    if (elapsedMs < phase.untilMs) return phase.intervalMs;
  }
  return null;
}

export function ItemCard({
  token,
  item,
  locale,
  uploadedCount,
  files,
  rejection,
  autoRequestMissingPages,
  onUploaded,
  onStatusChange,
}: {
  token: string;
  item: RequestItem;
  locale: "fr" | "en";
  uploadedCount: number;
  // The files the client has sent for this item (oldest first), each with the
  // accountant's per-file decision.
  files: PortalFile[];
  // Bilingual AI rejection summary for this item (from the latest upload's
  // usability verdict). Lets the re-upload banner follow the language toggle
  // instead of being stuck in the single language `item.rejection_reason` was
  // written in. Null for manual / legacy rejections — those fall back to the
  // column text.
  rejection: { fr: string; en: string } | null;
  // The firm's "auto-ask the client for missing pages" setting (migration 0330).
  // When ON, an incomplete multi-page set shows the client a plain-language
  // "please send the missing page" line here; when OFF the accountant handles
  // it and the client sees nothing.
  autoRequestMissingPages: boolean;
  onUploaded: (file: { id: string; name: string; mime: string }) => void;
  onStatusChange: (s: RequestItemStatus) => void;
}) {
  const t = useTranslations("Portal");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Surfaced when the background AI classifier flagged the upload as the
  // wrong document or otherwise unusable. Lets the client retry without
  // having to wait for the email/SMS.
  const [aiRejection, setAiRejection] = useState<string | null>(null);
  // The flip side: the AI affirmatively recognised the latest upload as the
  // right document. Live-turn-only (like aiRejection) — after a reload the
  // per-file "In review" pill takes over; this is the instant reassurance.
  const [aiConfirmed, setAiConfirmed] = useState(false);
  // True while we're polling /api/portal/upload-status for the latest
  // upload's verdict. Shows a small "Checking…" hint so the client knows
  // the document is being reviewed (without making them wait on the
  // upload itself).
  const [checking, setChecking] = useState(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  // The most recent upload still waiting on a verdict. Phones SUSPEND the page
  // (lock screen / app switch), which freezes the in-flight poll — so the
  // background verdict can land unseen while the page sleeps. We re-poll this
  // file when the page becomes visible again. Cleared once a verdict settles.
  const awaitingVerdictRef = useRef<string | null>(null);
  const [pendingNa, startNa] = useTransition();
  // Drag-and-drop a file straight onto the card (desktop nicety; the Upload
  // button is the primary path and works everywhere).
  const [dragging, setDragging] = useState(false);
  // Which uploaded photo (if any) is open in the full-screen enlarge view.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // The files the client can preview (oldest-first): photos show a real
  // thumbnail, PDFs a first-page view on tap. Both are tappable tiles and
  // appear in the enlarge view. Drives the tiles + the lightbox.
  const isPdfFile = (f: PortalFile) => f.mime === "application/pdf";
  const isImageFile = (f: PortalFile) =>
    !!f.mime && f.mime.startsWith("image/");
  const previewableFiles = files.filter((f) => isImageFile(f) || isPdfFile(f));

  // Re-check the verdict when the page comes back to the foreground. On phones
  // the poll is frozen while the page is backgrounded, so a verdict delivered
  // by the background worker meanwhile would otherwise never surface until a
  // manual reload. pollVerdict() aborts any prior poll and restarts cleanly, so
  // calling it again is safe; its first request resolves instantly if the
  // verdict already landed. No-op on cards with no upload awaiting a verdict.
  useEffect(() => {
    function recheckOnReturn() {
      if (document.visibilityState !== "visible") return;
      const fileId = awaitingVerdictRef.current;
      if (fileId) void pollVerdict(fileId);
    }
    document.addEventListener("visibilitychange", recheckOnReturn);
    window.addEventListener("focus", recheckOnReturn);
    return () => {
      document.removeEventListener("visibilitychange", recheckOnReturn);
      window.removeEventListener("focus", recheckOnReturn);
    };
    // pollVerdict is stable for our purposes (it reads refs/state, not props
    // that change between renders); re-subscribing every render is needless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const interval = pollIntervalFor(Date.now() - startedAt);
        if (interval == null) break; // gave up — the email/SMS fallback covers it
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
              } else if (body.verdict?.confirmed) {
                setAiConfirmed(true);
              }
              // Verdict has settled — stop the foreground re-check from
              // re-polling a file that's already resolved.
              if (awaitingVerdictRef.current === fileId) {
                awaitingVerdictRef.current = null;
              }
              // Re-pull the server-rendered portal data so EVERYTHING the
              // verdict touched (item status, file states, progress, banners)
              // updates in place — no manual reload. The portal page is
              // force-dynamic, so refresh() refetches for real. Client state
              // (this card's banners, scroll) is preserved.
              if (!ctl.signal.aborted) router.refresh();
              break;
            }
          }
          // A 404 means the file is gone (deleted) — stop. A rate-limited
          // response (429) is transient: keep waiting, the next attempt is
          // already on a slower schedule.
          else if (res.status === 404) {
            break;
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          // Network blip — wait and retry until the schedule gives up.
        }
        await new Promise((r) => setTimeout(r, interval));
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

  // Preferred upload path: the file travels as sequential ~3.5 MB parts
  // through OUR domain (each request fits the hosting platform's ~4.5 MB
  // function-body cap, and same-origin requests have no CORS preflight to
  // fail — the earlier browser→storage signed PUT died in preflight, see
  // lib/storage.ts). The finalize call reassembles the parts server-side and
  // runs the normal pipeline. Every step retries with backoff: portal
  // uploads happen on flaky phone connections, where a dropped request is
  // normal, and the part route is idempotent so retries are safe. Returns
  // null only when the endpoints don't exist yet (deployment skew) so the
  // caller can fall back to the legacy route; THROWS for real answers (too
  // large, bad type, rate limit, exhausted retries).
  async function chunkedUpload(file: File): Promise<UploadResponse | null> {
    const uploadId = newUploadId();
    const totalParts = Math.max(1, Math.ceil(file.size / UPLOAD_PART_BYTES));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    for (let seq = 0; seq < totalParts; seq++) {
      const part = file.slice(
        seq * UPLOAD_PART_BYTES,
        (seq + 1) * UPLOAD_PART_BYTES,
      );
      let stored = false;
      for (let attempt = 0; attempt < 3 && !stored; attempt++) {
        if (attempt > 0) await sleep(400 * attempt);
        let res: Response;
        try {
          const fd = new FormData();
          fd.append("token", token);
          fd.append("item_id", item.id);
          fd.append("upload_id", uploadId);
          fd.append("seq", String(seq));
          fd.append("mime", file.type);
          fd.append("chunk", part, `part-${seq}`);
          res = await fetch("/api/portal/upload-chunk", {
            method: "POST",
            body: fd,
          });
        } catch {
          continue; // network drop — retry this part
        }
        if (res.ok) {
          stored = true;
          break;
        }
        if (
          res.status === 404 &&
          !res.headers.get("content-type")?.includes("json")
        ) {
          return null; // endpoint doesn't exist yet (deployment skew)
        }
        if (res.status >= 500) continue; // transient — retry
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? "upload_failed"); // 4xx = real answer
      }
      if (!stored) throw new Error("upload_failed");
    }

    // Finalize: reassemble + run the pipeline. Retried on network drops and
    // 5xx (the server keeps the staged parts on transient failures and is
    // idempotent via a success marker, so retrying is always safe — a retry
    // after a lost success response returns the SAME success). missing_file
    // is therefore a REAL failure now, never a phantom success.
    let fin: Response | null = null;
    for (let attempt = 0; attempt < 4 && !fin; attempt++) {
      if (attempt > 0) await sleep(500 * attempt);
      try {
        fin = await fetch("/api/portal/upload-complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            item_id: item.id,
            upload_id: uploadId,
            total_parts: totalParts,
            filename: file.name,
            mime: file.type,
          }),
        });
        if (!fin.ok && fin.status >= 500 && attempt < 3) fin = null; // retry 5xx
      } catch {
        fin = null; // network drop — retry
      }
    }
    if (!fin) throw new Error("upload_failed");
    if (!fin.ok) {
      const j = (await fin.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(j?.error ?? "upload_failed");
    }
    return (await fin.json().catch(() => null)) as UploadResponse;
  }

  // Legacy single-request path (bytes in the form body). Still the fallback
  // when the direct flow is unreachable; fine for smaller files.
  async function legacyUpload(file: File): Promise<UploadResponse> {
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
    return (await res.json().catch(() => null)) as UploadResponse;
  }

  async function uploadFiles(files: FileList) {
    setError(null);
    setAiRejection(null);
    setAiConfirmed(false);
    // Cancel any prior poll — the new upload is what we care about now.
    pollAbortRef.current?.abort();
    setChecking(false);
    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setError("too_large");
        break;
      }
      setUploading(true);
      try {
        const body = (await chunkedUpload(file)) ?? (await legacyUpload(file));
        // Always count the upload — the file IS saved server-side. The
        // verdict only governs whether we surface a "try again" message
        // on top of that.
        onUploaded({
          id: body?.file_id ?? `pending-${Date.now()}-${file.name}`,
          name: file.name,
          mime: file.type,
        });
        // Kick off polling for the AI verdict. We don't await it — the
        // user gets immediate "upload complete" feedback and the verdict
        // banner (if any) appears within a few seconds. Polling is
        // cancelled if a new upload starts or the component unmounts.
        if (typeof body?.file_id === "string") {
          // Remember it so a foreground-return can resume the check if a
          // phone suspended the page mid-poll (see the visibility effect).
          awaitingVerdictRef.current = body.file_id;
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

  // The line-level banner is the "needs a fix" call to action. It still appears
  // whenever there's an outstanding rejection (live OR persisted), but it only
  // PRINTS the live current-turn verdict (`aiRejection`); the persisted per-file
  // reasons now render under each file in the list below, so the banner never
  // repeats them. `bannerMsg` still drives WHEN the banner (and `hasIssue`)
  // shows. The upload route clears `item.rejection_reason` on every new upload,
  // so it never goes stale across attempts.
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
  // The single client-facing state shown on this card — drives the icon, the
  // badge, and the tint. Approval-based, never upload-based.
  const ds = displayState(item.status, hasIssue);

  // Set-aware "a page is missing" ask. Shown ONLY when the firm opted into
  // auto-asking the client AND the group review concluded a specific page is
  // missing — otherwise the accountant handles it and the client sees nothing.
  // The sentence is the model's plain-language ask, already client-facing.
  const setAssessment = item.ai_set_assessment;
  const missingPageAsk =
    autoRequestMissingPages && setAssessment?.outcome === "incomplete"
      ? (locale === "fr"
          ? setAssessment.client_request_fr || setAssessment.client_request_en
          : setAssessment.client_request_en || setAssessment.client_request_fr
        ).trim() || null
      : null;

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
          : ds === "approved"
            ? "border-success/30 bg-success/[0.04]"
            : ds === "needs_attention"
              ? "border-warning/30 bg-warning/[0.05]"
              : ds === "in_review"
                ? "border-accent/25 bg-accent/[0.03]"
                : ds === "na"
                  ? "border-border/60 bg-muted/30"
                  : "border-border/60 bg-card/40 hover:border-border hover:bg-card hover:shadow-sm",
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <StatusIcon state={ds} />
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
            <StatusBadge state={ds} />
          </div>

          {bannerMsg && (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2.5 text-sm">
              <div className="flex items-center gap-1.5 font-medium text-warning">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                {item.status === "rejected"
                  ? t("rejected_action_needed")
                  : t("ai_rejected_title")}
              </div>
              {/* Only the LIVE current-turn verdict prints here; persisted
                  per-file reasons render under each file below, so the banner
                  never repeats them. */}
              {aiRejection && (
                <p className="mt-1 text-foreground/80">{aiRejection}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {t("ai_rejected_help")}
              </p>
            </div>
          )}

          {/* Set-aware "please send the missing page" ask. Item-level, plain
              language, no scores — the client just needs to know what to add.
              Sits below any per-file banner; an incomplete set normally has no
              per-file rejection, so the two rarely co-occur. */}
          {missingPageAsk && (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2.5 text-sm">
              <div className="flex items-start gap-1.5 text-foreground/80">
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-warning"
                  aria-hidden
                />
                <span>{missingPageAsk}</span>
              </div>
            </div>
          )}

          {/* The flip side of the warning banner: instant reassurance when the
              check recognised the upload as the right document. Suppressed the
              moment any issue banner is active — never both at once, and never
              alongside a missing-page ask. */}
          {aiConfirmed && !bannerMsg && !missingPageAsk && (
            <div className="mt-3 rounded-lg border border-success/30 bg-success/[0.08] px-3 py-2.5 text-sm">
              <div className="flex items-center gap-1.5 font-medium text-success">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                {t("ai_confirmed_title")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("ai_confirmed_help")}
              </p>
            </div>
          )}

          {/* The documents the client has sent for this line. On an active line
              each shows its filename + simple status (and a per-file reason if
              it needs a fix). On an APPROVED line we drop the status noise and
              just show a compact strip of the pictures they sent, so they can
              still see (and enlarge) their own documents. */}
          {ds !== "approved" && files.length > 0 && (
            <ul className="mt-3 space-y-2.5">
              {files.map((f) => {
                // Each rejected file shows its OWN plain reason (French
                // default), so the client knows exactly what is wrong with
                // that file. Only rejected files carry a reason.
                const fileReason =
                  f.status === "rejected" && f.reason
                    ? locale === "fr"
                      ? f.reason.fr
                      : f.reason.en
                    : null;
                // A previewable file (photo or PDF) opens the enlarge view at
                // its position among this item's previewable files.
                const previewIndex = previewableFiles.findIndex(
                  (x) => x.id === f.id,
                );
                return (
                  <li key={f.id} className="flex items-center gap-2.5 text-sm">
                    <PortalFileThumb
                      token={token}
                      file={f}
                      onOpen={
                        previewIndex >= 0
                          ? () => setLightboxIndex(previewIndex)
                          : undefined
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="min-w-0 flex-1 truncate text-foreground/80"
                          title={f.name}
                        >
                          {f.name}
                        </span>
                        <FileStatusPill status={f.status} />
                      </div>
                      {fileReason && (
                        <p className="mt-1 text-xs leading-relaxed text-warning">
                          {fileReason}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {ds === "approved" && files.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {files.map((f) => {
                const previewIndex = previewableFiles.findIndex(
                  (x) => x.id === f.id,
                );
                return (
                  <PortalFileThumb
                    key={f.id}
                    token={token}
                    file={f}
                    onOpen={
                      previewIndex >= 0
                        ? () => setLightboxIndex(previewIndex)
                        : undefined
                    }
                  />
                );
              })}
            </div>
          )}

          {lightboxIndex !== null && previewableFiles[lightboxIndex] && (
            <PortalImageLightbox
              token={token}
              items={previewableFiles.map((f) => ({
                id: f.id,
                name: f.name,
                kind: isPdfFile(f) ? "pdf" : "image",
              }))}
              index={lightboxIndex}
              onClose={() => setLightboxIndex(null)}
              onIndexChange={setLightboxIndex}
            />
          )}

          {error && <ErrorLine error={error} />}

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {ds === "approved" ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                <Check className="size-4" aria-hidden />
                {t("status_all_set")}
              </span>
            ) : item.status === "na" ? (
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
                {/* Discoverability hint for the drag-and-drop, which already
                    works. Pointer/desktop only (the media query) so a touch
                    user is never told to "drop files"; the Upload button stays
                    the primary path everywhere. */}
                <span className="hidden items-center text-xs text-muted-foreground [@media(pointer:fine)]:inline-flex">
                  {t("or_drop_here")}
                </span>
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
            {ds !== "approved" && uploadedCount > 0 && item.status !== "na" && (
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

// The single client-facing state shown on a card. Approval-based (section 6):
// an AI auto-reject leaves the item 'pending' but carries a reason (hasIssue),
// which must read as "needs attention", not "not started".
type DisplayState =
  | "approved"
  | "needs_attention"
  | "in_review"
  | "not_started"
  | "na";

function displayState(
  status: RequestItemStatus,
  hasIssue: boolean,
): DisplayState {
  if (status === "na") return "na";
  if (status === "approved") return "approved";
  if (status === "rejected" || hasIssue) return "needs_attention";
  if (status === "submitted") return "in_review";
  return "not_started";
}

function StatusIcon({ state }: { state: DisplayState }) {
  const ring =
    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full";
  if (state === "approved") {
    return (
      <span className={cn(ring, "bg-success text-white")}>
        <Check className="size-3.5" aria-hidden />
      </span>
    );
  }
  if (state === "needs_attention") {
    return (
      <span className={cn(ring, "bg-warning/15 text-warning")}>
        <AlertTriangle className="size-3.5" aria-hidden />
      </span>
    );
  }
  if (state === "in_review") {
    // A clock, NOT a check — uploaded but not yet accepted, so it must not look
    // done (the old green check on upload was the original bug).
    return (
      <span className={cn(ring, "bg-accent/15 text-accent")}>
        <Clock className="size-3.5" aria-hidden />
      </span>
    );
  }
  if (state === "na") {
    return (
      <span className={cn(ring, "border-2 border-muted-foreground/20 text-muted-foreground")}>
        <X className="size-3" aria-hidden />
      </span>
    );
  }
  // not_started — hollow ring
  return (
    <span
      className="mt-0.5 size-6 shrink-0 rounded-full border-2 border-muted-foreground/25"
      aria-hidden
    />
  );
}

function StatusBadge({ state }: { state: DisplayState }) {
  const t = useTranslations("Portal");
  const base =
    "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  if (state === "approved")
    return (
      <span className={cn(base, "bg-success/15 text-success")}>
        {t("status_approved")}
      </span>
    );
  if (state === "needs_attention")
    return (
      <span className={cn(base, "bg-warning/15 text-warning")}>
        {t("status_needs_attention")}
      </span>
    );
  if (state === "in_review")
    return (
      <span className={cn(base, "bg-accent/15 text-accent")}>
        {t("status_in_review")}
      </span>
    );
  if (state === "na")
    return (
      <span className={cn(base, "bg-muted text-muted-foreground")}>
        {t("status_na")}
      </span>
    );
  // not_started — a quiet neutral pill; the prominent Upload button is the real
  // call to action.
  return (
    <span className={cn(base, "bg-muted/60 text-muted-foreground")}>
      {t("status_not_started")}
    </span>
  );
}

// A tiny per-file status pill in the document list. Reuses the line-level
// status words so the client reads consistent language.
function FileStatusPill({ status }: { status: PortalFile["status"] }) {
  const t = useTranslations("Portal");
  const base = "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium";
  if (status === "approved")
    return (
      <span className={cn(base, "bg-success/15 text-success")}>
        {t("status_approved")}
      </span>
    );
  if (status === "rejected")
    return (
      <span className={cn(base, "bg-warning/15 text-warning")}>
        {t("status_needs_attention")}
      </span>
    );
  return (
    <span className={cn(base, "bg-accent/10 text-accent")}>
      {t("status_in_review")}
    </span>
  );
}

// A small preview tile in the per-file list. For an image it renders a real
// thumbnail (token-scoped endpoint) that opens the enlarge view on click; for a
// PDF / other type, or if the thumbnail fails to load, a plain document tile.
// Exported so the signature card reuses the exact same tile (no second thumb).
export function PortalFileThumb({
  token,
  file,
  onOpen,
}: {
  token: string;
  file: PortalFile;
  onOpen?: () => void;
}) {
  const t = useTranslations("Portal");
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Image tiles load straight from storage (file.url). If that ever fails (e.g.
  // a legacy HEIC original a browser can't decode) we fall back to the on-the-fly
  // render route, then to a plain icon.
  const [useRenderRoute, setUseRenderRoute] = useState(false);
  const isImage = !!file.mime && file.mime.startsWith("image/");
  const isPdf = file.mime === "application/pdf";
  const renderRouteSrc = `/api/portal/files/${file.id}/thumb?token=${encodeURIComponent(
    token,
  )}&w=144`;
  const imageSrc = file.url && !useRenderRoute ? file.url : renderRouteSrc;

  // Photo: the real picture tile, served straight from storage when possible.
  if (isImage && onOpen && !failed) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("preview_open", { name: file.name })}
        className="group/thumb relative size-10 shrink-0 overflow-hidden rounded-md bg-muted/40 ring-1 ring-border/60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {/* Gentle placeholder until the thumbnail has decoded. */}
        {!loaded && (
          <span
            className="absolute inset-0 animate-pulse bg-muted/60"
            aria-hidden
          />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (file.url && !useRenderRoute) setUseRenderRoute(true);
            else setFailed(true);
          }}
          className={cn(
            "size-full object-cover transition-[transform,opacity] duration-200 group-hover/thumb:scale-105",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      </button>
    );
  }

  // PDF: a clear, tappable document tile that opens the first-page view.
  if (isPdf && onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("preview_open", { name: file.name })}
        className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent ring-1 ring-border/60 transition hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <FileText className="size-4" aria-hidden />
      </button>
    );
  }

  // Non-previewable file, or a photo whose thumbnail failed to load: a plain
  // static tile.
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground ring-1 ring-border/60">
      <FileText className="size-4" aria-hidden />
    </span>
  );
}
