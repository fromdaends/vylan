"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Download,
  Upload,
  Check,
  Clock,
  PenLine,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { RequestItem, RequestItemStatus } from "@/lib/db/request-items";
import type { PortalFile } from "@/lib/db/portal";
import { PortalFileThumb } from "./item-card";
import { PortalImageLightbox } from "./portal-image-lightbox";

// Same upload contract as the document card (PDF or a photo of the signed page).
const ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";

// The single client-facing state of a signature item. Approval-based, mirroring
// the document card: pending = the client's turn to sign, submitted = with the
// accountant, rejected = the accountant sent it back (needs a new copy), approved
// = signed and confirmed.
type SignDisplayState = "to_sign" | "in_review" | "needs_attention" | "signed";

function signDisplayState(status: RequestItemStatus): SignDisplayState {
  if (status === "approved") return "signed";
  if (status === "submitted") return "in_review";
  if (status === "rejected") return "needs_attention";
  return "to_sign";
}

// A signature item on the client portal: download the document the accountant
// supplied, sign it your own way, upload the signed copy back. Reuses the
// document card's file tile + lightbox and the same upload endpoint. No AI
// quality check (a signed form is not a tax slip). If the accountant sends a
// copy back, the client sees the reason per file and re-uploads. Plain language,
// no internal jargon. No legal / e-signature claims — the client signs by their
// own means and the accountant confirms.
export function SignatureItemCard({
  token,
  item,
  locale,
  files,
  onUploaded,
}: {
  token: string;
  item: RequestItem;
  locale: "fr" | "en";
  // The signed copies the client has returned for this item (oldest first), each
  // with the accountant's per-file decision + a plain reason when sent back.
  files: PortalFile[];
  onUploaded: (file: { id: string; name: string; mime: string }) => void;
}) {
  const t = useTranslations("Portal");
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const label = locale === "fr" && item.label_fr ? item.label_fr : item.label;
  const ds = signDisplayState(item.status);
  // The client should download + (re)upload while it's their turn: before
  // signing, or after the accountant sent a copy back.
  const showActions = ds === "to_sign" || ds === "needs_attention";

  const isPdfFile = (f: PortalFile) => f.mime === "application/pdf";
  const isImageFile = (f: PortalFile) =>
    !!f.mime && f.mime.startsWith("image/");
  const previewableFiles = files.filter((f) => isImageFile(f) || isPdfFile(f));

  // Token-scoped link to the document the accountant uploaded to be signed.
  // Opens in a new tab (inline) so the client can read/save/print it.
  const signingDocUrl = item.signing_doc_path
    ? `/api/portal/items/${item.id}/signing-doc?token=${encodeURIComponent(token)}`
    : null;

  async function uploadFiles(fileList: FileList) {
    setError(null);
    for (const file of Array.from(fileList)) {
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
        onUploaded({
          id: body?.file_id ?? `pending-${Date.now()}-${file.name}`,
          name: file.name,
          mime: file.type,
        });
      } catch (e) {
        setError((e as Error).message);
        break;
      } finally {
        setUploading(false);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div
      className={cn(
        "group rounded-xl border p-4 transition-all duration-200 sm:p-5",
        ds === "signed"
          ? "border-success/30 bg-success/[0.04]"
          : ds === "needs_attention"
            ? "border-warning/30 bg-warning/[0.05]"
            : ds === "in_review"
              ? "border-accent/25 bg-accent/[0.03]"
              : "border-border/60 bg-card/40 hover:border-border hover:bg-card hover:shadow-sm",
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <SignStatusIcon state={ds} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[15px] font-medium leading-snug text-foreground">
                {label}
              </h3>
              {showActions && (
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("sign_instructions")}
                </p>
              )}
            </div>
            <SignStatusBadge state={ds} />
          </div>

          {/* When the accountant sent the signed copy back, a clear call to
              action. The specific reason shows under the file below. */}
          {ds === "needs_attention" && (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2.5 text-sm">
              <div className="flex items-center gap-1.5 font-medium text-warning">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                {t("sign_rejected_action_needed")}
              </div>
            </div>
          )}

          {/* The signed copies the client has returned, each with its own status
              (in review / signed / needs a fix) and a plain reason when the
              accountant sent it back. Mirrors the document card's file list. */}
          {files.length > 0 && (
            <ul className="mt-3 space-y-2.5">
              {files.map((f) => {
                const fileReason =
                  f.status === "rejected" && f.reason
                    ? locale === "fr"
                      ? f.reason.fr
                      : f.reason.en
                    : null;
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
                        <SignFileStatusPill status={f.status} />
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

          {error && <SignErrorLine error={error} />}

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {ds === "signed" ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                <Check className="size-4" aria-hidden />
                {t("sign_done")}
              </span>
            ) : (
              <>
                {signingDocUrl && (
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={signingDocUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download className="size-4" aria-hidden />
                      {t("sign_download")}
                    </a>
                  </Button>
                )}
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
                  variant={
                    ds === "in_review" || ds === "needs_attention"
                      ? "outline"
                      : "default"
                  }
                >
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Upload className="size-4" aria-hidden />
                  )}
                  {uploading ? t("uploading") : t("sign_upload")}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SignErrorLine({ error }: { error: string }) {
  const t = useTranslations("Portal");
  const key = `errors.${error}` as const;
  const message =
    typeof (t as unknown as { has?: (k: string) => boolean }).has === "function"
      ? (t as unknown as { has: (k: string) => boolean }).has(key)
        ? t(key)
        : error
      : error;
  return <p className="mt-2 text-xs text-destructive">{message}</p>;
}

function SignStatusIcon({ state }: { state: SignDisplayState }) {
  const ring =
    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full";
  if (state === "signed") {
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
    return (
      <span className={cn(ring, "bg-accent/15 text-accent")}>
        <Clock className="size-3.5" aria-hidden />
      </span>
    );
  }
  // to_sign — a pen on a faint accent ring: it's the client's turn to act.
  return (
    <span className={cn(ring, "bg-accent/10 text-accent")}>
      <PenLine className="size-3.5" aria-hidden />
    </span>
  );
}

function SignStatusBadge({ state }: { state: SignDisplayState }) {
  const t = useTranslations("Portal");
  const base =
    "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  if (state === "signed")
    return (
      <span className={cn(base, "bg-success/15 text-success")}>
        {t("sign_status_signed")}
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
  // to_sign — a quiet pill; the prominent Download/Upload buttons are the CTA.
  return (
    <span className={cn(base, "bg-muted/60 text-muted-foreground")}>
      {t("sign_status_to_sign")}
    </span>
  );
}

// Per-file status pill for a returned signed copy. Reuses the card's own words:
// in review / signed / needs attention.
function SignFileStatusPill({ status }: { status: PortalFile["status"] }) {
  const t = useTranslations("Portal");
  const base = "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium";
  if (status === "approved")
    return (
      <span className={cn(base, "bg-success/15 text-success")}>
        {t("sign_status_signed")}
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
