"use client";

// The engagement letter awaiting FIELD PLACEMENT — the "needs you" card.
//
// Editor-mode letters are SignWell drafts until the accountant places the
// signature fields; meanwhile the portal tells the client the letter is
// "being prepared" and blocks acceptance. Review found the trap this card
// closes: the only other resume affordance lives inside the signatures hub
// panel, which a flow-built letter never creates a task for — so an
// abandoned editor session stranded the client with no accountant-side
// control anywhere. This card IS that control, mounted beside the workflow
// gate on the engagement page.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSignaturePlacementUrlAction } from "@/app/actions/signatures";
import { openPlacementEditor } from "@/components/engagements/placement-editor";

export function LetterPlacementCard({ itemId }: { itemId: string }) {
  const t = useTranslations("Automations");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open() {
    setBusy(true);
    setFailed(false);
    try {
      // The one-shot edit URL expires once opened, so it is never stored —
      // this re-reads a fresh one (the same rule the resume launcher follows).
      const res = await getSignaturePlacementUrlAction(itemId);
      if (!res.url) {
        setFailed(true);
        return;
      }
      await openPlacementEditor({
        url: res.url,
        itemId,
        onSettled: () => router.refresh(),
      });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-4 py-3">
      <PenLine
        className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden
      />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{t("letter_placement_waiting")}</span>{" "}
        <span className="text-muted-foreground">
          {t("letter_placement_note")}
        </span>
      </p>
      <Button size="sm" disabled={busy} onClick={open}>
        {busy ? (
          <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
        ) : null}
        {t("letter_placement_button")}
      </Button>
      {failed && (
        <p className="w-full text-xs text-destructive">
          {t("letter_placement_error")}
        </p>
      )}
    </div>
  );
}
