"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Upload,
  RotateCcw,
  Loader2,
  CheckCircle2,
  TriangleAlert,
  Paperclip,
} from "lucide-react";
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
import { formatCurrency, formatDate, type AppLocale } from "@/lib/format";

// One already-posted QuickBooks transaction the server thinks this draft may
// duplicate (smart posting part 3). Shape mirrors the /post route's
// needs_match_confirmation payload.
type MatchCandidateView = {
  qboId: string;
  entity: "bill" | "purchase" | "invoice";
  txnDate: string | null;
  totalAmt: number | null;
  docNumber: string | null;
  vendorName: string | null;
  // The transaction's currency code (e.g. "USD"), shown next to the amount so a
  // multicurrency candidate can't be mistaken for the draft's home-currency
  // amount. null in a single-currency company.
  currency: string | null;
};

// Stage 5 posting controls on a QuickBooks draft card.
//   approved + expense  -> "Post to QuickBooks" (confirm; posts a Bill)
//   approved + income   -> "Post to QuickBooks" (confirm; posts an Invoice)
//   approved + unknown  -> a muted "not supported" note (can't tell the type)
//   posted              -> "Posted · {when}" + "Undo" (confirm; deletes it)
//   posted (matched)    -> "Matched to existing" + "Unlink" (nothing deleted)
// Posts to the stable /post and /void endpoints, then refreshes. Read-only on
// QuickBooks until clicked; the server re-validates everything before writing.
// When the server answers needs_match_confirmation ("this may already be in
// QuickBooks"), the confirm dialog swaps to the candidate list so the
// accountant attaches to an existing transaction or forces a new one.
export function PostDraftControls({
  fileId,
  status,
  direction,
  expenseMode = "bill",
  postedAtLabel,
  postedByName,
  postError,
  taxNote,
  receiptAttached = false,
  matchedExisting = false,
  locale,
}: {
  fileId: string;
  status: DraftStatus;
  direction: "expense" | "income" | "unknown";
  // For an expense: "purchase" (already paid) posts a QuickBooks Expense; "bill"
  // (unpaid) posts a Bill. Drives only the confirm copy. Ignored for income.
  expenseMode?: "bill" | "purchase";
  // Pre-formatted posted date (server formats it; null when not posted).
  postedAtLabel: string | null;
  postedByName: string | null;
  postError: string | null;
  // Set when QuickBooks' computed tax differs from the document's tax on this
  // posted transaction (a discrepancy to review); null otherwise.
  taxNote?: string | null;
  // Whether the source receipt has been attached to the posted transaction.
  // false on a posted draft offers a one-click "Attach receipt" retry (the post
  // attaches best-effort; this recovers a miss without a void + re-post).
  receiptAttached?: boolean;
  // Smart posting part 3: this 'posted' draft was MATCHED to a transaction that
  // was already in QuickBooks (Vylan created nothing) — the posted row shows
  // the matched label and "Undo" becomes "Unlink" (nothing gets deleted).
  matchedExisting?: boolean;
  // For formatting the match candidates' dates/amounts client-side.
  locale: AppLocale;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  // Non-null while the dialog is showing the "already in QuickBooks?" choice;
  // an EMPTY array means the accountant's earlier pick disappeared server-side.
  const [matchCandidates, setMatchCandidates] = useState<
    MatchCandidateView[] | null
  >(null);

  async function run(path: "post" | "void", body?: Record<string, unknown>) {
    setFailed(false);
    setPending(true);
    try {
      const r = await fetch(`/api/quickbooks/suggestions/${fileId}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const res = (await r.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        candidates?: MatchCandidateView[];
      } | null;
      if (r.ok && res?.ok) {
        setOpen(false);
        setMatchCandidates(null);
        router.refresh();
      } else if (res?.error === "needs_match_confirmation") {
        // Not a failure: the server wants the accountant to decide. Swap the
        // dialog to the candidate list (kept open).
        setMatchCandidates(res.candidates ?? []);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  // Retry attaching the receipt to a posted transaction. No confirm dialog: it's
  // non-destructive, and the server is idempotent (an already-attached draft
  // returns ok without re-uploading), so a stray double-click can't duplicate the
  // QuickBooks attachment. Shows the server's detail on failure (e.g. an
  // unsupported file type), which retrying won't fix — so it's worth reading.
  async function runAttach() {
    setAttachError(null);
    setAttaching(true);
    try {
      const r = await fetch(
        `/api/quickbooks/suggestions/${fileId}/attach-receipt`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      const res = (await r.json().catch(() => null)) as {
        ok?: boolean;
        detail?: string;
      } | null;
      if (r.ok && res?.ok) {
        router.refresh();
      } else {
        setAttachError(res?.detail || t("attach_failed"));
      }
    } catch {
      setAttachError(t("attach_failed"));
    } finally {
      setAttaching(false);
    }
  }

  // Posted: show who/when + an Undo (void) control, plus a tax-discrepancy note
  // when QuickBooks' computed tax didn't match the document.
  if (status === "posted") {
    return (
      <div className="flex flex-col gap-1.5">
        {taxNote && (
          <p
            role="alert"
            className="flex items-start gap-1 text-[11px] text-warning"
          >
            <TriangleAlert
              className="mt-px h-3 w-3 shrink-0"
              aria-hidden="true"
            />
            <span>{taxNote}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {matchedExisting
              ? t("matched_label")
              : postedByName
                ? t("posted_by", { name: postedByName })
                : t("posted_label")}
            {postedAtLabel ? ` · ${postedAtLabel}` : ""}
          </span>
          <div className="flex items-center gap-2">
            {(failed || postError) && (
              <span role="alert" className="text-[11px] text-warning">
                {failed
                  ? t(matchedExisting ? "unlink_failed" : "undo_failed")
                  : postError}
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
                  {t(matchedExisting ? "unlink_button" : "undo_button")}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>
                    {t(matchedExisting ? "unlink_title" : "undo_title")}
                  </DialogTitle>
                  <DialogDescription>
                    {t(matchedExisting ? "unlink_body" : "undo_body")}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setOpen(false)}
                    disabled={pending}
                  >
                    {t("post_cancel")}
                  </Button>
                  <Button
                    onClick={() => run("void")}
                    disabled={pending}
                    className="gap-1.5"
                  >
                    {pending ? (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    )}
                    {t(matchedExisting ? "unlink_go" : "undo_go")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        {/* Receipt-attach status: confirmed once attached, else a one-click retry
            so a best-effort miss on post is recoverable without a void + re-post. */}
        {receiptAttached ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Paperclip className="h-3 w-3 shrink-0" aria-hidden="true" />
            {t("receipt_attached")}
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={runAttach}
              disabled={attaching}
              className="h-7 gap-1 text-[11px] text-muted-foreground"
            >
              {attaching ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <Paperclip className="h-3 w-3" aria-hidden="true" />
              )}
              {t("attach_receipt_button")}
            </Button>
            {attachError && (
              <span role="alert" className="text-[11px] text-warning">
                {attachError}
              </span>
            )}
          </div>
        )}
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
  const confirmBody =
    direction === "income"
      ? t("post_body_income")
      : expenseMode === "purchase"
        ? t("post_body_purchase")
        : t("post_body");

  // Approved expense/income: Post (with retry error if a prior attempt failed).
  // The same dialog swaps to the "already in QuickBooks?" candidate list when
  // the server answers needs_match_confirmation.
  const entityLabel = (e: MatchCandidateView["entity"]) =>
    e === "invoice"
      ? t("match_entity_invoice")
      : e === "purchase"
        ? t("match_entity_purchase")
        : t("match_entity_bill");

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {(failed || postError) && (
        <span
          role="alert"
          className="inline-flex items-center gap-1 text-[11px] text-warning"
        >
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
          {failed ? t("post_failed") : postError}
        </span>
      )}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setMatchCandidates(null);
            setFailed(false);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button size="sm" className="ml-auto gap-1.5">
            <Upload className="h-4 w-4" aria-hidden="true" />
            {t("post_button")}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          {matchCandidates == null ? (
            <>
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
                <Button
                  onClick={() => run("post")}
                  disabled={pending}
                  className="gap-1.5"
                >
                  {pending ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Upload className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t("post_go")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("match_title")}</DialogTitle>
                <DialogDescription>
                  {matchCandidates.length === 0
                    ? t("match_gone")
                    : t("match_body")}
                </DialogDescription>
              </DialogHeader>
              {matchCandidates.length > 0 && (
                <ul className="max-h-56 space-y-2 overflow-y-auto">
                  {matchCandidates.map((c) => (
                    <li
                      key={`${c.entity}-${c.qboId}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {c.vendorName || entityLabel(c.entity)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {c.totalAmt != null
                            ? formatCurrency(c.totalAmt, locale)
                            : "—"}
                          {c.currency ? ` ${c.currency}` : ""}
                          {c.txnDate
                            ? ` · ${formatDate(c.txnDate, locale, "medium")}`
                            : ""}
                          {` · ${entityLabel(c.entity)}`}
                          {c.docNumber ? ` · #${c.docNumber}` : ""}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          run("post", {
                            matchAction: "attach",
                            attachQboId: c.qboId,
                            // Pin to the chosen type — QBO ids are unique only
                            // per type (a Bill and a Purchase can share an id).
                            attachEntity: c.entity,
                          })
                        }
                        disabled={pending}
                        className="gap-1.5"
                      >
                        {pending ? (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Paperclip className="h-4 w-4" aria-hidden="true" />
                        )}
                        {t("match_attach")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {failed && (
                <p role="alert" className="text-sm text-warning">
                  {t("post_failed")}
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
                <Button
                  variant="outline"
                  onClick={() => run("post", { matchAction: "create" })}
                  disabled={pending}
                  className="gap-1.5"
                >
                  {pending ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Upload className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t("match_post_new")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
