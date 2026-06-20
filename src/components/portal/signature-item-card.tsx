"use client";

import { useTranslations } from "next-intl";
import { Check, Clock, PenLine, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { RequestItem, RequestItemStatus } from "@/lib/db/request-items";

// The single client-facing state of a signature item. Approval-based, mirroring
// the document card: to_sign = the client's turn, in_review = with the
// accountant, needs_attention = sent back, signed = signed and confirmed.
type SignDisplayState = "to_sign" | "in_review" | "needs_attention" | "signed";

function signDisplayState(status: RequestItemStatus): SignDisplayState {
  if (status === "approved") return "signed";
  if (status === "submitted") return "in_review";
  if (status === "rejected") return "needs_attention";
  return "to_sign";
}

// Phase 1 of the SignWell migration. The old transport-only mechanics (download
// the document, sign it your own way, upload a copy back, accountant approves)
// have been removed. Real EMBEDDED e-signing inside this portal lands in a later
// phase; until then this card shows the document and a calm "signing is being
// set up" message so nothing here pretends to collect a file. No legal claim is
// made yet — the embedded SignWell signing replaces this stub.
export function SignatureItemCard({
  item,
  locale,
}: {
  item: RequestItem;
  locale: "fr" | "en";
}) {
  const t = useTranslations("Portal");
  const label = locale === "fr" && item.label_fr ? item.label_fr : item.label;
  const ds = signDisplayState(item.status);

  return (
    <div
      className={cn(
        "group rounded-xl border p-4 transition-all duration-200 sm:p-5",
        ds === "signed"
          ? "border-success/30 bg-success/[0.04]"
          : "border-border/60 bg-card/40",
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <SignStatusIcon state={ds} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[15px] font-medium leading-snug text-foreground">
                {label}
              </h3>
              {ds === "signed" ? (
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-success">
                  <Check className="size-4" aria-hidden />
                  {t("sign_done")}
                </p>
              ) : (
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("sign_setup_pending")}
                </p>
              )}
            </div>
            <SignStatusBadge state={ds} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SignStatusIcon({ state }: { state: SignDisplayState }) {
  const ring =
    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full";
  if (state === "signed") {
    return (
      <span className={cn(ring, "bg-success text-white")}>
        <Check className="size-3.5" aria-hidden />
      </span>
    );
  }
  if (state === "needs_attention") {
    return (
      <span className={cn(ring, "bg-warning/15 text-warning")}>
        <AlertTriangle className="size-3.5" aria-hidden />
      </span>
    );
  }
  if (state === "in_review") {
    return (
      <span className={cn(ring, "bg-accent/15 text-accent")}>
        <Clock className="size-3.5" aria-hidden />
      </span>
    );
  }
  // to_sign — a pen on a faint accent ring: it's the client's turn to act.
  return (
    <span className={cn(ring, "bg-accent/10 text-accent")}>
      <PenLine className="size-3.5" aria-hidden />
    </span>
  );
}

function SignStatusBadge({ state }: { state: SignDisplayState }) {
  const t = useTranslations("Portal");
  const base =
    "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  if (state === "signed")
    return (
      <span className={cn(base, "bg-success/15 text-success")}>
        {t("sign_status_signed")}
      </span>
    );
  if (state === "needs_attention")
    return (
      <span className={cn(base, "bg-warning/15 text-warning")}>
        {t("status_needs_attention")}
      </span>
    );
  if (state === "in_review")
    return (
      <span className={cn(base, "bg-accent/15 text-accent")}>
        {t("status_in_review")}
      </span>
    );
  // to_sign — a quiet pill; embedded signing (next phase) will be the CTA.
  return (
    <span className={cn(base, "bg-muted/60 text-muted-foreground")}>
      {t("sign_status_to_sign")}
    </span>
  );
}
