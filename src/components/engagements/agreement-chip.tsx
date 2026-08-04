"use client";

// Where the AGREEMENT is — draft, sent, accepted, active, complete, cancelled.
//
// Replaces the workflow-stage pill on the engagements list. The founder's
// diagnosis: "an engagement might have six tasks going on simultaneously, and
// it's hard to put a specific word on what's going on."
//
// The stage pill answered a question the engagement can no longer answer. These
// six words describe the DEAL, which stays true however much work is in flight;
// the work itself is the Tasks column beside this, which already reads "1/2".
//
// Same outline shape as the chip it replaces — surface background, hairline
// border, a small colour dot, label in the normal text colour. That was chosen
// against Canopy's own list and there is no reason to relitigate it here.

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  AGREEMENT_STATUSES,
  agreementLabelKey,
  type AgreementStatus,
} from "@/lib/engagements/agreement";

type LabelKey =
  | "agr_draft"
  | "agr_sent"
  | "agr_accepted"
  | "agr_active"
  | "agr_complete"
  | "agr_cancelled";

// Delegates to the shared key builder so the chip and the Status filter menu
// can never name the same state differently.
const LABEL_KEY = Object.fromEntries(
  AGREEMENT_STATUSES.map((s) => [s, agreementLabelKey(s)]),
) as Record<AgreementStatus, LabelKey>;

// Only three colours across six states, deliberately. A distinct hue per state
// is what made the old column six different washes saying nothing extra: what
// you scan this list for is "is anything waiting on me", and that is a
// three-way answer.
const DOT_CLASS: Record<AgreementStatus, string> = {
  // Not live yet.
  draft: "bg-muted-foreground/60",
  cancelled: "bg-muted-foreground/60",
  // With the client, nothing for you to do.
  sent: "bg-accent",
  accepted: "bg-accent",
  // Under way.
  active: "bg-accent",
  // Done.
  complete: "bg-success",
};

export function AgreementChip({ status }: { status: AgreementStatus }) {
  const t = useTranslations("Engagements");
  return (
    <Badge
      variant="outline"
      className="gap-1.5 whitespace-nowrap font-normal text-foreground"
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[status])}
      />
      {t(LABEL_KEY[status])}
    </Badge>
  );
}
