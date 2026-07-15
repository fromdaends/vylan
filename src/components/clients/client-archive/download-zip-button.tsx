"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

// Triggers a server-built ZIP export. The endpoint builds the archive, stores
// it, and returns JSON { url } (Vercel can't return zip bytes as a body), then
// the browser downloads straight from storage — the same proven path as the
// engagement "Download all". A plain <a download> would save the JSON, so the
// download MUST go through this fetch-then-navigate flow.
export function ArchiveDownloadZipButton({
  endpoint,
  label,
  preparingLabel,
  emptyLabel,
  failedLabel,
  tooLargeLabel,
  variant = "outline",
  size = "sm",
  className,
}: {
  endpoint: string;
  label: string;
  preparingLabel: string;
  emptyLabel: string;
  failedLabel: string;
  // Shown when the archive is too large to build in one file (413). Only the
  // whole-client button can hit this; the per-engagement one never caps.
  tooLargeLabel?: string;
  variant?: "outline" | "secondary" | "default" | "ghost";
  size?: "sm" | "default" | "icon-sm";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        if (res.status === 413) {
          // A long-lived, actionable message (steer to per-engagement ZIPs).
          toast.error(tooLargeLabel ?? failedLabel, { duration: 8000 });
        } else {
          toast.error(res.status === 404 ? emptyLabel : failedLabel);
        }
        return;
      }
      const data = (await res.json().catch(() => null)) as { url?: string } | null;
      if (!data?.url) {
        toast.error(failedLabel);
        return;
      }
      // Navigate to the signed storage URL; its Content-Disposition forces a
      // save without navigating the page away.
      window.location.href = data.url;
    } catch {
      toast.error(failedLabel);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={run}
      disabled={busy}
      className={cn(className)}
      aria-label={busy ? preparingLabel : label}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Download className="size-4" />
      )}
      {size !== "icon-sm" && <span>{busy ? preparingLabel : label}</span>}
    </Button>
  );
}
