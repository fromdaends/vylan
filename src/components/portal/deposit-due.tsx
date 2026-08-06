"use client";

// The step between agreeing and starting: pay the deposit.
//
// ── THE FOUNDER'S FLOW, THEIR WORDS ────────────────────────────────────────
//
// "they read the whole proposal and stuff then agree then pay and once they pay
// the client portal activates for the client and bobs your uncle."
//
// So this is the portal's THIRD state. The proposal is behind them (agreed, and
// recorded — a card that fails cannot un-say yes), and their documents are ahead
// of them, waiting on this.
//
// ── IT REUSES PaymentDueCard, IT DOES NOT REDRAW ONE ───────────────────────
//
// CLAUDE.md's rule: "never create a second copy of UI that already exists." The
// portal already has a card that states an amount, renders a generated
// invoice's lines and taxes, and carries Stripe and PayPal buttons that work.
// A hand-rolled "pay your deposit" box would be a photocopy that drifts the day
// either rail changes — and the drift would be in a payment button.
//
// So the only thing here is the WRAPPER: the sentence explaining why they are
// looking at a bill straight after agreeing, and what happens once it clears.

import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { PaymentDueCard } from "@/components/portal/payment-due-card";

// Exactly PaymentDueCard's props, passed through whole. Not destructured: the
// firm name is needed for the heading AND by the card, and pulling it out of the
// spread is how it silently stops reaching the card.
export function DepositDue(
  props: React.ComponentProps<typeof PaymentDueCard>,
) {
  const t = useTranslations("Portal");
  const firmName = props.firmName;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <div className="mb-6 flex flex-col items-center text-center">
        <span
          className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        >
          <CheckCircle2 className="size-5" />
        </span>
        {/* Lead with the good news. They just agreed to something — being met
            by a bare invoice reads as though the agreement did not register. */}
        <h1 className="text-xl font-semibold tracking-tight">
          {t("deposit_accepted_title", { firm: firmName })}
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {t("deposit_accepted_body")}
        </p>
      </div>

      <PaymentDueCard {...props} />

      <p className="mt-6 text-center text-xs text-muted-foreground">
        {t("deposit_credited_note")}
      </p>
    </div>
  );
}
