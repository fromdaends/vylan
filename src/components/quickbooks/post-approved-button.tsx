"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Upload, Loader2 } from "lucide-react";
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

// "Post all approved" (Stage 5, Phase 2). Posts every approved EXPENSE draft in
// the current view (optionally scoped to the selected client) to QuickBooks in
// one request, behind a confirm. Renders nothing when there's nothing to post.
// The server recomputes the set + posts each idempotently; each can be undone.
export function PostApprovedButton({
  postableCount,
  client,
}: {
  postableCount: number;
  client: string | null;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // Smart posting part 3: how many drafts the run LEFT ALONE because they look
  // like they're already in QuickBooks (each card must be opened to decide).
  // Non-null keeps the dialog open on a summary instead of silently closing.
  const [needsReview, setNeedsReview] = useState<number | null>(null);

  if (postableCount <= 0) return null;

  async function run() {
    setFailed(false);
    setPending(true);
    try {
      const r = await fetch("/api/quickbooks/suggestions/post-approved", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client }),
      });
      const res = (await r.json().catch(() => null)) as {
        ok?: boolean;
        needsReview?: number;
      } | null;
      if (r.ok && res?.ok) {
        router.refresh();
        if (typeof res.needsReview === "number" && res.needsReview > 0) {
          setNeedsReview(res.needsReview);
        } else {
          setOpen(false);
        }
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setFailed(false);
          setNeedsReview(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Upload className="h-4 w-4" aria-hidden="true" />
          {t("post_all", { count: postableCount })}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {needsReview != null ? (
          // The run finished but left some drafts for the accountant: they look
          // like they may already be in QuickBooks. Summarize instead of
          // silently closing.
          <>
            <DialogHeader>
              <DialogTitle>{t("post_all_title")}</DialogTitle>
              <DialogDescription>
                {t("post_all_needs_review", { count: needsReview })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>
                {t("post_all_needs_review_close")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("post_all_title")}</DialogTitle>
              <DialogDescription>
                {t("post_all_confirm", { count: postableCount })}
              </DialogDescription>
            </DialogHeader>
            {failed && (
              <p role="alert" className="text-sm text-warning">
                {t("post_all_failed")}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                {t("post_cancel")}
              </Button>
              <Button onClick={run} disabled={pending} className="gap-1.5">
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-4 w-4" aria-hidden="true" />
                )}
                {t("post_all_go", { count: postableCount })}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
