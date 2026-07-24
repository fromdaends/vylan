"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openPlacementEditor } from "@/components/engagements/placement-editor";
import { retrySignatureSetupAction } from "@/app/actions/signatures";

// Shown on a signature row whose SignWell setup FAILED ("Signing setup needed").
// Retries by re-creating the SignWell request from the stored PDF. On success in
// "place anywhere" mode it opens the field-placement editor straight away;
// otherwise it refreshes so the row reflects the new status — or the updated
// failure reason if it failed again (e.g. the client still has no email).
export function RetrySignatureSetup({ itemId }: { itemId: string }) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function retry() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await retrySignatureSetupAction(itemId);
      if (res.editUrl) {
        await openPlacementEditor({
          url: res.editUrl,
          itemId,
          onSettled: () => {
            setBusy(false);
            router.refresh();
          },
        });
        return;
      }
      // Sent (fallback mode) or failed again (the reason is re-persisted on the
      // row) — refresh so the row shows the up-to-date status / reason.
      setBusy(false);
      router.refresh();
    } catch {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={retry} disabled={busy}>
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <RotateCcw className="size-4" aria-hidden />
      )}
      {busy ? t("sig_setup_retrying") : t("sig_setup_retry")}
    </Button>
  );
}
