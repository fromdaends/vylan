"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { QuickUpload } from "./quick-upload";

// THE HOME DROPZONE — the shortest path from "a client emailed me three PDFs"
// to those PDFs being in Vylan.
//
// It is a surface for the EXISTING QuickUpload dialog, not a second uploader:
// dropping files (or clicking "browse your computer") opens that dialog with
// the files already in hand, so there is still exactly one upload flow, one
// size limit and one import-run ledger behind it. Building a parallel uploader
// here is how two upload paths with different rules start existing.

export function UploadDropzone({
  clients,
}: {
  clients: { id: string; name: string }[];
}) {
  const t = useTranslations("Files");
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const [dropped, setDropped] = useState<File[] | null>(null);
  // Drag events fire for every child element, so a bare enter/leave pair
  // flickers the highlight as the pointer crosses the icon and the text.
  // Counting enters and leaves is the standard fix.
  const depth = useRef(0);

  function openWith(files: File[] | null) {
    setDropped(files);
    setOpen(true);
  }

  return (
    <>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          depth.current -= 1;
          if (depth.current <= 0) {
            depth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length > 0) openWith(files);
        }}
        className={cn(
          "rounded-[14px] border-[1.5px] border-dashed px-5 py-6.5 text-center transition-colors",
          dragging
            ? "border-accent bg-accent-subtle"
            : "border-border/90 bg-card",
        )}
      >
        <span className="inline-flex size-11 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Upload className="size-5" aria-hidden />
        </span>
        <p className="mt-3 text-sm font-semibold">{t("home_upload_drop")}</p>
        <p className="mt-[3px] text-[13px] text-muted-foreground">
          {t("home_upload_or")}{" "}
          <button
            type="button"
            onClick={() => openWith(null)}
            className="font-medium text-accent transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            {t("home_upload_browse")}
          </button>
        </p>
        <p className="mt-2.5 text-xs text-muted-foreground/75">
          {t("home_upload_hint")}
        </p>
      </div>

      <QuickUpload
        clients={clients}
        defaultClientId={null}
        externalOpen={open}
        onExternalOpenChange={(o) => {
          setOpen(o);
          if (!o) setDropped(null);
        }}
        initialFiles={dropped}
      />
    </>
  );
}
