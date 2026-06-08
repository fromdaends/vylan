"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Upload, Check, Clock, PenLine, Loader2 } from "lucide-react";
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
// the document card: pending/rejected/na = still the client's turn to sign,
// submitted = with the accountant, approved = signed and confirmed.
type SignDisplayState = "to_sign" | "in_review" | "signed";

function signDisplayState(status: RequestItemStatus): SignDisplayState {
  if (status === "approved") return "signed";
  if (status === "submitted") return "in_review";
  return "to_sign";
}

// A signature item on the client portal: download the document the accountant
// supplied, sign it your own way, upload the signed copy back. Reuses the
// document card's file tile + lightbox and the same upload endpoint. No AI
// quality check (a signed form is not a tax slip), no rejection banner, no
// "not applicable". Plain language, no internal jargon. No legal / e-signature
// claims — the client signs by their own means and the accountant confirms.
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
  // The signed copies the client has returned for this item (oldest first).
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
              {ds !== "signed" && (
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("sign_instructions")}
                </p>
              )}
            </div>
            <SignStatusBadge state={ds} />
          </div>

          {/* The signed copies the client has returned — a compact strip of
              tappable tiles (photo or PDF) they can enlarge, same as the
              document card. */}
          {files.length > 0 && (
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

          {error && <SignErrorLine error={error} />}

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
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
            {ds === "signed" ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                <Check className="size-4" aria-hidden />
                {t("sign_done")}
              </span>
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
                  variant={ds === "in_review" ? "outline" : "default"}
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
