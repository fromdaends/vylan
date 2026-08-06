"use client";

// What the client sees when a firm asks them to agree.
//
// This is the whole point of everything upstream. The founder: "you need to
// build an engagement proposal viewer for the client where they can either
// accept or not and review the terms and everything. IT should look beautifull
// for the client and when the client accepts the proposal the engagement is
// marked active, the work starts and the client can view their client portal."
//
// ── IT RENDERS ProposalPreview, NOT ITS OWN MARKUP ─────────────────────────
//
// The panel in the firm's template builder and the page the client reads are
// THE SAME COMPONENT. That was the reason it was pulled out of the builder in
// the first place. A firm that previews a proposal and a client who opens one
// are looking at identical markup — which is the only way a preview can be
// trusted to mean anything.
//
// ── ONE DECISION, TWO ANSWERS, NEITHER RUSHED ──────────────────────────────
//
// Accepting is a contract. It gets a confirm step, not because a mis-click is
// likely but because "I didn't mean to agree to that" is a conversation no firm
// should have to have. Declining asks for a reason and accepts silence — a
// client who will not explain must still be able to say no.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  ProposalPreview,
  type ProposalPreviewData,
} from "@/components/engagements/proposal-preview";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import {
  acceptProposalAction,
  declineProposalAction,
} from "@/app/actions/proposal";

export function ProposalAcceptance({
  token,
  data,
  locale,
  firmName,
  /** Already declined — they can still read it, and change their mind. */
  declinedAt,
}: {
  token: string;
  data: ProposalPreviewData;
  locale: "en" | "fr";
  firmName: string;
  declinedAt?: string | null;
}) {
  const t = useTranslations("Portal");
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState(false);

  function accept() {
    setError(false);
    startTransition(async () => {
      const res = await acceptProposalAction(token);
      // No client-side redirect: the action revalidates and the portal renders
      // its normal view once accepted. Sending them somewhere would mean two
      // sources of truth about what happens next.
      if (!res.ok) setError(true);
    });
  }

  function decline() {
    setError(false);
    startTransition(async () => {
      const res = await declineProposalAction(token, reason.trim());
      if (!res.ok) setError(true);
      else setDeclining(false);
    });
  }

  return (
    // A wash behind the sheet, so the document reads as a page sitting on a
    // desk rather than a panel bolted into an app.
    <div className="w-full bg-muted/30 px-0 py-0 sm:px-4 sm:py-12">
      {/* The centred firm eyebrow + "Proposal" + intro line that used to sit
          here are GONE. The document now carries its own letterhead, title and
          addressed-to block — having both meant the page announced itself
          twice, in two different visual languages, before you reached the
          thing you came to read. */}
      {declinedAt && (
        // Not a dead end. A declined proposal is still readable, and they can
        // still accept — people change their minds, and a firm that revises
        // after a "no" wants the yes to be one click away.
        <p className="mx-auto mb-4 w-full max-w-[47rem] rounded-xl border border-border bg-card px-4 py-3 text-center text-sm text-muted-foreground">
          {t("proposal_declined_note")}
        </p>
      )}

      {/* The width cap lives HERE, not in ProposalPreview. The preview is also
          rendered inside the builder's preview card, which is wider than this
          and had 448px of proposal floating in the middle of it — so the
          container decides, and this container is a client reading a document
          on a phone or a laptop.

          FULL WIDTH, not max-w-md. 448px was a SIDE-PANE measurement that
          followed the component here: the contract rendered as a narrow strip of
          small type, NARROWER than the Accept/Decline box directly beneath it,
          which is the giveaway that the number came from somewhere else. This is
          the widest thing on the page because it is the thing they are here to
          read. */}
      {/* ── THE SHEET ──────────────────────────────────────────────────────
          A page on a wash, not a card in an app. Edge-to-edge on a phone,
          floating from sm: up, with a soft lift that reads as paper. 47rem is
          a document measure — long enough for a priced table, short enough
          that a terms clause is still readable. */}
      <div className="mx-auto w-full max-w-[47rem] overflow-hidden bg-card px-5 py-10 shadow-[0_1px_2px_rgba(0,0,0,.05),0_16px_48px_-20px_rgba(0,0,0,.22)] sm:rounded-xl sm:px-14 sm:py-14">
        <ProposalPreview
          data={data}
          locale={locale}
          activeStep="acceptance"
          // The client's copy: nothing clamped, no step rail, no inert chip.
          variant="document"
        />
      </div>

      {/* ── THE DECISION ─────────────────────────────────────────────────
          The founder: the accept buttons "look super skinny and weird".

          They were `size="lg"` in a row that let the primary shrink to
          `flex-1` beside a ghost button, so the most consequential control on
          the page ended up the same weight as a toolbar action. This is the one
          thing the client is here to do: it gets a full-width, tall, obviously
          pressable button, with the decline as a quiet text link UNDER it
          rather than a sibling competing for the same row. */}
      <div className="mx-auto mt-6 w-full max-w-[47rem] rounded-2xl border border-border bg-card p-6 sm:p-8">
        {!confirming && !declining && (
          <>
            <p className="text-[15px] leading-relaxed">
              {t("proposal_agree_note")}
            </p>
            <Button
              type="button"
              className="mt-5 h-14 w-full rounded-xl text-base font-semibold shadow-sm transition-transform active:scale-[0.99]"
              disabled={pending}
              onClick={() => setConfirming(true)}
            >
              {t("proposal_accept")}
            </Button>
            {!declinedAt && (
              <button
                type="button"
                disabled={pending}
                onClick={() => setDeclining(true)}
                className="mx-auto mt-4 block text-[13px] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground disabled:opacity-50"
              >
                {t("proposal_decline")}
              </button>
            )}
          </>
        )}

        {confirming && (
          <>
            <p className="text-base font-semibold">
              {t("proposal_confirm_title")}
            </p>
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
              {t("proposal_confirm_body", { firm: firmName })}
            </p>
            <Button
              type="button"
              className="mt-5 h-14 w-full rounded-xl text-base font-semibold shadow-sm transition-transform active:scale-[0.99]"
              disabled={pending}
              onClick={accept}
            >
              {pending ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="size-5" aria-hidden />
              )}
              {t("proposal_confirm_accept")}
            </Button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="mx-auto mt-4 block text-[13px] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground disabled:opacity-50"
            >
              {t("proposal_back")}
            </button>
          </>
        )}

        {declining && (
          <>
            <p className="text-base font-semibold">
              {t("proposal_decline_title")}
            </p>
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
              {t("proposal_decline_body")}
            </p>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("proposal_decline_placeholder")}
              aria-label={t("proposal_decline_placeholder")}
              rows={3}
              className="mt-3"
            />
            {/* Never disabled on an empty reason: a client who will not
                explain must still be able to say no. Outline rather than the
                filled primary — saying no should be easy to do and not the
                thing the page is pushing you toward. */}
            <Button
              type="button"
              variant="outline"
              className="mt-5 h-14 w-full rounded-xl text-base font-semibold transition-transform active:scale-[0.99]"
              disabled={pending}
              onClick={decline}
            >
              {t("proposal_decline_send")}
            </Button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setDeclining(false)}
              className="mx-auto mt-4 block text-[13px] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground disabled:opacity-50"
            >
              {t("proposal_back")}
            </button>
          </>
        )}

        {error && (
          <p className={cn("mt-3 text-sm text-destructive")}>
            {t("proposal_failed")}
          </p>
        )}
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
        {t("proposal_questions", { firm: firmName })}
      </p>
    </div>
  );
}
