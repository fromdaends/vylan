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
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <header className="mb-8 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {firmName}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("proposal_title")}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("proposal_intro")}
        </p>
      </header>

      {declinedAt && (
        // Not a dead end. A declined proposal is still readable, and they can
        // still accept — people change their minds, and a firm that revises
        // after a "no" wants the yes to be one click away.
        <p className="mb-6 rounded-xl border border-border bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">
          {t("proposal_declined_note")}
        </p>
      )}

      <div className="flex justify-center">
        <ProposalPreview data={data} locale={locale} activeStep="sign" />
      </div>

      {/* ── THE DECISION ───────────────────────────────────────────────── */}
      <div className="mt-8 rounded-2xl border border-border bg-card p-5 sm:p-6">
        {!confirming && !declining && (
          <>
            <p className="text-sm leading-relaxed">{t("proposal_agree_note")}</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
              <Button
                type="button"
                size="lg"
                className="flex-1"
                disabled={pending}
                onClick={() => setConfirming(true)}
              >
                {t("proposal_accept")}
              </Button>
              {!declinedAt && (
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  className="sm:flex-none"
                  disabled={pending}
                  onClick={() => setDeclining(true)}
                >
                  {t("proposal_decline")}
                </Button>
              )}
            </div>
          </>
        )}

        {confirming && (
          <>
            <p className="text-sm font-medium">{t("proposal_confirm_title")}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t("proposal_confirm_body", { firm: firmName })}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
              <Button
                type="button"
                size="lg"
                className="flex-1"
                disabled={pending}
                onClick={accept}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-4" aria-hidden />
                )}
                {t("proposal_confirm_accept")}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                {t("proposal_back")}
              </Button>
            </div>
          </>
        )}

        {declining && (
          <>
            <p className="text-sm font-medium">{t("proposal_decline_title")}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
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
            <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
              {/* Never disabled on an empty reason: a client who will not
                  explain must still be able to say no. */}
              <Button
                type="button"
                size="lg"
                variant="outline"
                disabled={pending}
                onClick={decline}
              >
                {t("proposal_decline_send")}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="ghost"
                disabled={pending}
                onClick={() => setDeclining(false)}
              >
                {t("proposal_back")}
              </Button>
            </div>
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
