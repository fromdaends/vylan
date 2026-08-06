"use client";

// The header's stage pills (design 2a) — the agreement's progression as
// labeled pills, replacing the dot stepper.
//
// The WORDS come from the same resolver + i18n keys as everywhere else
// (resolveAgreementStatus → agr_*), so the pills cannot disagree with the
// engagements list or the detail panel about where a job stands. What is new
// here is only the DRAWING: passed stages collapse into one "N earlier stages"
// pill (click to expand, click any expanded pill to re-collapse), the current
// stage is the one accent pill, and future stages are outlines.
//
// Collapse state is client-side and per-mount on purpose — it is a reading
// aid, not a fact about the engagement.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  AGREEMENT_STATUSES,
  agreementLabelKey,
  type AgreementStatus,
} from "@/lib/engagements/agreement";

// The pill rail draws the normal life of an engagement. `cancelled` is not a
// stage on a path — a cancelled job renders one destructive pill instead.
const STAGES = AGREEMENT_STATUSES.filter((s) => s !== "cancelled");

const PILL_BASE =
  "inline-flex flex-none items-center gap-1.5 rounded-full px-[11px] py-1 text-xs font-medium transition-colors duration-150";

function Separator() {
  return (
    <ChevronRight className="size-3 flex-none text-border" aria-hidden />
  );
}

function PassedPill({
  label,
  onClick,
}: {
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        PILL_BASE,
        "bg-secondary text-foreground/70",
        onClick && "cursor-pointer hover:bg-secondary/70",
      )}
    >
      <Check className="size-[11px]" strokeWidth={3} aria-hidden />
      {label}
    </button>
  );
}

export function EngagementStagePills({
  status,
}: {
  status: AgreementStatus;
}) {
  const t = useTranslations("Engagements");
  const [open, setOpen] = useState(false);

  if (status === "cancelled") {
    return (
      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        <span
          className={cn(PILL_BASE, "bg-destructive/10 text-destructive")}
        >
          {t(agreementLabelKey("cancelled"))}
        </span>
      </div>
    );
  }

  const currentIndex = STAGES.indexOf(status);
  const passed = STAGES.slice(0, currentIndex);
  const rest = STAGES.slice(currentIndex);
  // One passed stage reads faster shown than summarized; the collapse earns
  // its click only once there are at least two behind you.
  const collapsible = passed.length >= 2;

  const nodes: React.ReactNode[] = [];

  if (collapsible && !open) {
    nodes.push(
      <PassedPill
        key="collapsed"
        label={t("stages_earlier", { count: passed.length })}
        onClick={() => setOpen(true)}
      />,
    );
  } else {
    for (const s of passed) {
      nodes.push(
        <PassedPill
          key={s}
          label={t(agreementLabelKey(s))}
          onClick={collapsible ? () => setOpen(false) : undefined}
        />,
      );
    }
  }

  for (const s of rest) {
    const current = s === status;
    nodes.push(
      current ? (
        <span
          key={s}
          className={cn(
            PILL_BASE,
            "bg-accent font-semibold text-white shadow-[0_2px_6px] shadow-accent/25",
          )}
        >
          <span
            aria-hidden
            className="inline-block size-1.5 rounded-full bg-current"
          />
          {t(agreementLabelKey(s))}
        </span>
      ) : (
        <span
          key={s}
          className={cn(PILL_BASE, "border border-border text-muted-foreground")}
        >
          {t(agreementLabelKey(s))}
        </span>
      ),
    );
  }

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
      {nodes.map((n, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <Separator />}
          {n}
        </span>
      ))}
    </div>
  );
}
