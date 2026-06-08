"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

// Full-screen enlarge view for the client's own uploaded photos. Loads the
// larger render from the same token-scoped endpoint as the thumbnails. Plain by
// design: just the client's own document and its filename, no status, no notes.
export function PortalImageLightbox({
  token,
  images,
  index,
  onClose,
  onIndexChange,
}: {
  token: string;
  images: { id: string; name: string }[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}) {
  const t = useTranslations("Portal");
  const closeRef = useRef<HTMLButtonElement>(null);
  const count = images.length;
  const current = images[index];

  const go = useCallback(
    (delta: number) => {
      if (count < 2) return;
      onIndexChange((index + delta + count) % count);
    },
    [count, index, onIndexChange],
  );

  // Move focus into the dialog and lock background scroll while open.
  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, go]);

  if (!current) return null;

  const src = `/api/portal/files/${current.id}/thumb?token=${encodeURIComponent(
    token,
  )}&w=1600`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.name}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium"
          title={current.name}
        >
          {current.name}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t("preview_close")}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current.id}
          src={src}
          alt={current.name}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
              aria-label={t("preview_prev")}
              className="absolute left-3 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <ChevronLeft className="size-6" aria-hidden />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
              aria-label={t("preview_next")}
              className="absolute right-3 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <ChevronRight className="size-6" aria-hidden />
            </button>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white tabular-nums">
              {index + 1} / {count}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
