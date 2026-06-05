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

// The always-available "Preview" entry point that sits in the engagement's
// checklist header. Clicking it opens the focused review overlay; the overlay
// lives in the same component so it stays in the engagement's context.
export function EngagementPreview(props: EngagementPreviewProps) {
  const t = useTranslations("Preview");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <LayoutGrid className="size-4" />
        {t("button")}
      </Button>
      {open && <PreviewOverlay {...props} onClose={() => setOpen(false)} />}
    </>
  );
}
