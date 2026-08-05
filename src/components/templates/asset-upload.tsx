"use client";

// Upload a file for a template's Introduction row.
//
// The founder, on Video and Document being link-only: "It should allow for a
// actual file upload not just a link." Canopy's rows take either, and so do
// these — the Video row keeps its link field beside this, the Document row is
// upload-only because there is nothing to link to.
//
// The upload happens IMMEDIATELY on choosing a file, not on saving the
// template. Two reasons: a file has to travel before a payload can name it, and
// a 25 MB upload that only started when you hit "Save template" would make Save
// feel broken. The cost is an orphaned object if you then abandon the template —
// the safer of the two failures, since the alternative is a saved template
// pointing at a file that was never sent.

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadTemplateAssetAction } from "@/app/actions/template-assets";

export function AssetUpload({
  kind,
  fileName,
  onUploaded,
  onClear,
}: {
  kind: "video" | "document";
  /** The file already attached, if any. */
  fileName: string;
  onUploaded: (path: string, fileName: string) => void;
  onClear: () => void;
}) {
  const t = useTranslations("Templates");
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pick(file: File) {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("file", file);
      const res = await uploadTemplateAssetAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onUploaded(res.path, res.fileName);
    });
  }

  if (fileName) {
    return (
      <p className="flex items-center gap-2 text-xs">
        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{fileName}</span>
        <button
          type="button"
          onClick={onClear}
          aria-label={t("remove")}
          className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
        >
          <X className="size-3.5" />
        </button>
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={
          kind === "video"
            ? "video/mp4,video/quicktime,video/webm"
            : "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg"
        }
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so choosing the SAME file twice fires again — a file input
          // whose value has not changed emits nothing, which reads as the
          // second attempt doing nothing.
          e.target.value = "";
          if (file) pick(file);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="size-3.5" />
        {pending ? t("uploading") : t("upload_file")}
      </Button>
      {error && (
        <p className="text-xs text-destructive">
          {error === "file_type"
            ? t("upload_wrong_type")
            : error === "file_size"
              ? t("upload_too_big")
              : t("upload_failed")}
        </p>
      )}
    </div>
  );
}
