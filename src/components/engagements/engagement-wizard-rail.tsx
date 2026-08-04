"use client";

// The engagement wizard's left rail.
//
// The founder's reference is Canopy's Create Engagement modal: a column of
// steps down the left, each carrying a tick once it has what it needs, with one
// step's worth of form beside it.
//
// Why a rail and not a numbered "step 3 of 5" strip: an engagement is not a
// pipeline you walk once. You set a price, go back to add a document, come
// forward again. Every step here is reachable at any time — the rail is a
// TABLE OF CONTENTS, not a gate. That is also why nothing is disabled: a step
// you cannot click looks broken when the real message is "this is optional".
//
// The tick means "this step has what it needs", never "you have visited it".
// Rewarding a visit would put a tick on an empty Documents step, which is the
// one thing that actually stops you sending.

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export type WizardRailStep<K extends string> = {
  key: K;
  label: string;
  /** Whether this step has everything it needs. Drives the tick. */
  complete: boolean;
  /** Marks the step as required — Canopy's asterisk. */
  required?: boolean;
};

export function EngagementWizardRail<K extends string>({
  steps,
  current,
  onSelect,
  label,
}: {
  steps: WizardRailStep<K>[];
  current: K;
  onSelect: (key: K) => void;
  /** Accessible name for the nav. */
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="rounded-xl border border-border/60 bg-card p-2"
    >
      <ol className="flex flex-col gap-0.5">
        {steps.map((s) => {
          const active = s.key === current;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => onSelect(s.key)}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "group relative flex w-full items-center gap-2 rounded-lg py-2 pl-3 pr-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "font-medium text-accent"
                    : "text-foreground hover:bg-muted",
                )}
              >
                {/* The active marker is a bar on the leading edge, like the
                    reference. It sits INSIDE the padding rather than shifting
                    the label, so switching steps does not nudge the text. */}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-accent"
                  />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {s.label}
                  {s.required && (
                    <span aria-hidden className="ml-0.5 text-destructive">
                      *
                    </span>
                  )}
                </span>
                {/* Tick or empty circle — never a number. A number implies an
                    order you must follow, and you can fill these in any order. */}
                {s.complete ? (
                  <Check
                    className="size-4 shrink-0 text-success"
                    aria-hidden
                  />
                ) : (
                  <span
                    aria-hidden
                    className="size-4 shrink-0 rounded-full border-[1.5px] border-border"
                  />
                )}
                {/* Said out loud too: the tick is the only thing carrying this
                    for a sighted user, and it must not be the only thing
                    carrying it at all. */}
                <span className="sr-only">
                  {s.complete ? " — complete" : " — not started"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
