"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { RequestItem } from "@/lib/db/request-items";

// The overlay is portal-rendered, browser-only, and (in later phases) pulls in
// thumbnail + PDF rendering. Load it lazily so opening Preview is the only time
// that weight is fetched — the engagement page bundle stays light.
const PreviewOverlay = dynamic(
  () => import("./preview-overlay").then((m) => m.PreviewOverlay),
  { ssr: false },
);

export type EngagementPreviewProps = {
  uploads: UploadedFile[];
  items: RequestItem[];
  engagementId: string;
  engagementTitle: string;
  clientName: string | null;
  locale: "fr" | "en";
};

// The always-available "Preview" entry point. variant="header" (default) is the
// outline button in the checklist header that opens EVERY uploaded document;
// variant="item" is the smaller, quieter button on a single checklist row that
// opens just that item's documents (scoped — the engagement-wide "Download all"
// is hidden so it can't over-promise). The overlay lives in the same component
// so it stays in the engagement's context.
export function EngagementPreview({
  variant = "header",
  ...props
}: EngagementPreviewProps & { variant?: "header" | "item" }) {
  const t = useTranslations("Preview");
  const [open, setOpen] = useState(false);
  const isItem = variant === "item";

  return (
    <>
      <Button
        type="button"
        variant={isItem ? "ghost" : "outline"}
        size="sm"
        onClick={() => setOpen(true)}
        className={
          isItem
            ? "h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            : undefined
        }
      >
        <LayoutGrid className={isItem ? "size-3.5" : "size-4"} />
        {t("button")}
      </Button>
      {open && (
        <PreviewOverlay
          {...props}
          scoped={isItem}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
