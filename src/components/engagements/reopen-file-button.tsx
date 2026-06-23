"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Compact "Undo" control shown on an already-rejected document, in place of the
// reject (X) icon. Clicking it clears the rejection (the file goes back to
// in-review) so a rejected doc reads as DONE with an undo — never a redundant
// "reject again" prompt. Uses the stable /api/files/[id]/reopen endpoint
// (deploy-skew-proof), like the reject controls.
export function ReopenFileButton({ fileId }: { fileId: string }) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (pending) return;
    setPending(true);
    try {
      const r = await fetch(`/api/files/${fileId}/reopen`, { method: "POST" });
      const res = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      if (res?.ok) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={pending}
      aria-busy={pending}
      aria-label={t("file_undo_reject")}
      title={t("file_undo_reject")}
      className="text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <RotateCcw className={"size-4" + (pending ? " animate-spin" : "")} />
    </Button>
  );
}
