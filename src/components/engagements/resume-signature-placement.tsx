"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PenLine, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openSignWellSession } from "@/components/signwell/embed-loader";
import {
  getSignaturePlacementUrlAction,
  finalizeSignaturePlacementAction,
} from "@/app/actions/signatures";

// Shown on the accountant's signature row when a "place anywhere" request is a
// draft still awaiting field placement (status 'pending' with a SignWell doc):
// they started a request but closed the editor before positioning the field.
// This re-opens SignWell's editor with a FRESH url (the create-time one expires
// once opened), then finalizes on completion.
export function ResumeSignaturePlacement({ itemId }: { itemId: string }) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function resume() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const res = await getSignaturePlacementUrlAction(itemId);
      if (!res.url) {
        // "not_pending" means the editor already sent it, but our record didn't
        // catch up (a missed "completed" event). Finalize reconciles: it adopts
        // the live status, notifies the client, and advances the stage.
        if (res.error === "not_pending") {
          try {
            await finalizeSignaturePlacementAction(itemId);
          } catch {
            // Best-effort; the reconcile-on-load backstop still self-heals.
          }
          setBusy(false);
          router.refresh();
          return;
        }
        setError(true);
        setBusy(false);
        return;
      }
      await openSignWellSession({
        url: res.url,
        onCompleted: async () => {
          try {
            await finalizeSignaturePlacementAction(itemId);
          } catch {
            // Webhook/reconcile self-heal; the refresh shows the truth.
          }
          setBusy(false);
          router.refresh();
        },
        onClosed: () => {
          setBusy(false);
          router.refresh();
        },
        onError: () => {
          setError(true);
          setBusy(false);
        },
      });
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <Button size="sm" onClick={resume} disabled={busy}>
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <PenLine className="size-4" aria-hidden />
        )}
        {busy ? t("sig_placement_opening") : t("sig_finish_placement")}
      </Button>
      {error && (
        <p className="mt-2 text-sm text-destructive">{t("sig_placement_error")}</p>
      )}
    </div>
  );
}
