"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

// Shared "Download all (ZIP)" trigger, used by BOTH the engagement header menu
// and the Preview overlay. Both MUST go through here: the endpoint builds + stores
// the archive and returns a JSON { url }, and the browser then downloads straight
// from storage (Vercel can't return the zip bytes as a response body). A plain
// <a href download> against this JSON route would save the JSON, not the zip —
// which is exactly the regression this hook prevents by keeping one code path.
export function useDownloadAll(engagementId: string) {
  const t = useTranslations("Engagements");
  const [downloading, setDownloading] = useState(false);

  async function downloadAll() {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/files.zip`);
      if (!res.ok) {
        toast.error(
          res.status === 404
            ? t("download_all_empty")
            : t("download_all_failed"),
        );
        return;
      }
      const data = (await res.json().catch(() => null)) as { url?: string } | null;
      if (!data?.url) {
        toast.error(t("download_all_failed"));
        return;
      }
      // Navigate to the signed storage URL. Its Content-Disposition forces a
      // download (the file is saved, the page doesn't navigate away), and this
      // isn't tied to a DOM node, so the closing menu can't cancel it.
      window.location.href = data.url;
    } catch {
      toast.error(t("download_all_failed"));
    } finally {
      setDownloading(false);
    }
  }

  return { downloading, downloadAll };
}
