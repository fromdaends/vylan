"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { RequestItem } from "@/lib/db/request-items";
import type { PreviewView } from "./preview-model";

// The overlay is portal-rendered, browser-only, and (in later phases) pulls in
// thumbnail + PDF rendering. Load it lazily so opening Preview is the only time
// that weight is fetched — the engagement page bundle stays light.
const PreviewOverlay = dynamic(
  () => import("./preview-overlay").then((m) => m.PreviewOverlay),
  { ssr: false },
);

// A signature item's "document to sign" — the blank/template the accountant
// uploaded for the client to sign. It's NOT an uploaded_file (it lives on the
// request_item), so the preview can't derive it from `uploads`; the server
// signs a short-lived URL and passes it through so the overlay can surface it.
export type SigningDoc = {
  itemId: string;
  url: string;
  name: string;
  mime: string | null;
};

export type EngagementPreviewProps = {
  uploads: UploadedFile[];
  items: RequestItem[];
  engagementId: string;
  engagementTitle: string;
  clientName: string | null;
  locale: "fr" | "en";
  // Signature items' "document to sign", signed server-side. Optional so the
  // per-item preview (collection rows only) and tests can omit it.
  signingDocs?: SigningDoc[];
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
  // Deep-link support: /engagements/[id]?preview=1 auto-opens the overlay,
  // ?preview=flagged lands straight on the Flagged tab (the Needs-attention
  // "flagged files" rows link here). Only the header variant honors it — the
  // per-item buttons stay manual. Read once at mount; closing works normally.
  const searchParams = useSearchParams();
  const previewParam = searchParams?.get("preview") ?? null;
  const isItem = variant === "item";
  const [open, setOpen] = useState(() => !isItem && previewParam != null);
  const initialView: PreviewView | undefined =
    previewParam === "flagged" ? "flagged" : undefined;

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
          initialView={initialView}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
