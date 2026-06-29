"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Upload, RotateCcw, Loader2, CheckCircle2, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { DraftStatus } from "@/lib/quickbooks/draft-status";

// Stage 5 posting controls on a QuickBooks draft card.
//   approved + expense  -> "Post to QuickBooks" (confirm; posts a Bill)
//   approved + income   -> "Post to QuickBooks" (confirm; posts an Invoice)
//   approved + unknown  -> a muted "not supported" note (can't tell the type)
//   posted              -> "Posted · {when}" + "Undo" (confirm; deletes it)
// Posts to the stable /post and /void endpoints, then refreshes. Read-only on
// QuickBooks until clicked; the server re-validates everything before writing.
export function PostDraftControls({
  fileId,
  status,
  direction,
  postedAtLabel,
  postedByName,
  postError,
}: {
  fileId: string;
  status: DraftStatus;
  direction: "expense" | "income" | "unknown";
  // Pre-formatted posted date (server formats it; null when not posted).
  postedAtLabel: string | null;
  postedByName: string | null;
  postError: string | null;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(path: "post" | "void") {
    setFailed(false);
    setPending(true);
    try {
      const r = await fetch(`/api/quickbooks/suggestions/${fileId}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const res = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      if (r.ok && res?.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  // Posted: show who/when + an Undo (void) control.
  if (status === "posted") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-success">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          {postedByName
            ? t("posted_by", { name: postedByName })
            : t("posted_label")}
          {postedAtLabel ? ` · ${postedAtLabel}` : ""}
        </span>
        <div className="flex items-center gap-2">
          {(failed || postError) && (
            <span role="alert" className="text-[11px] text-warning">
              {failed ? t("undo_failed") : postError}
            </span>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-[11px] text-muted-foreground"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                {t("undo_button")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("undo_title")}</DialogTitle>
                <DialogDescription>{t("undo_body")}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  {t("post_cancel")}
                </Button>
                <Button onClick={() => run("void")} disabled={pending} className="gap-1.5">
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t("undo_go")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    );
  }

  // Approved but direction unknown (neither expense nor income) — can't post.
  if (direction !== "expense" && direction !== "income") {
    return (
      <p className="text-[11px] text-muted-foreground">
        {t("post_income_unsupported")}
      </p>
    );
  }

  // Income posts an Invoice; expense posts a Bill — the confirm copy reflects it.
  const confirmBody = direction === "income" ? t("post_body_income") : t("post_body");

  // Approved expense/income: Post (with retry error if a prior attempt failed).
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {(failed || postError) && (
        <span role="alert" className="inline-flex items-center gap-1 text-[11px] text-warning">
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
          {failed ? t("post_failed") : postError}
        </span>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" className="ml-auto gap-1.5">
            <Upload className="h-4 w-4" aria-hidden="true" />
            {t("post_button")}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("post_title")}</DialogTitle>
            <DialogDescription>{confirmBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("post_cancel")}
            </Button>
            <Button onClick={() => run("post")} disabled={pending} className="gap-1.5">
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="h-4 w-4" aria-hidden="true" />
              )}
              {t("post_go")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
