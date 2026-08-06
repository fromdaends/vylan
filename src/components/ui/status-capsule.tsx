import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

// STATUS CAPSULE — the UI kit's one way to mark a state.
//
// The rule the kit is built on: COLOR MARKS THE EXCEPTION. A resting state is
// plain text and gets no capsule at all; a state worth pointing at gets a
// NEUTRAL capsule — 1px --border, transparent background — with a small
// colored dot doing the signalling. Never a fully-colored pill: a wall of
// green/amber/red badges is exactly the noise this replaces, and it makes the
// one row that actually needs attention impossible to find.
//
// Tone maps to meaning, and the mapping is not negotiable:
//   success     — done, connected, approved
//   warning     — pending, overdue, waiting on someone (amber, NOT red)
//   destructive — damage only: failed, rejected, disconnected
//   accent      — informational, in progress
//   muted       — inert / archived
//
// One capsule, every surface (Files home rows, Browse rows, Filing settings
// hero) — per the cohesion rule, this is the only place the shape is defined.
//
// ── THE ONE EXCEPTION, AND WHY IT IS A VARIANT AND NOT A SECOND COMPONENT ──
//
// The capacity board's approved design uses FILLED pills — a blue-tinted "In
// progress", an amber "Waiting on client". That is the thing the rule above
// forbids, and the rule is not wrong: a board is precisely the wall of badges
// it warns about, since every card carries a status.
//
// The founder has seen the design and asked for it, so `variant="filled"`
// exists. It lives HERE rather than as a board-local pill, so the shape, the
// dot and the tone vocabulary still have exactly one definition — the drift
// this file was written to prevent is two pills, not two variants.
//
// Default is unchanged. Nothing outside the board is touched.

const capsuleVariants = cva(
  "inline-flex w-fit shrink-0 items-center rounded-full font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        outline: "border border-border",
        // Tint comes from the tone, below — this only removes the border the
        // outline version carries.
        filled: "border border-transparent",
      },
      size: {
        // Home rows and the Filing-settings hero.
        default: "gap-1.5 py-0.5 pr-2.5 pl-2 text-xs",
        // Browse rows, where the capsule sits inline beside a file name.
        sm: "gap-1.5 py-px pr-[9px] pl-[7px] text-[11.5px]",
      },
    },
    defaultVariants: { size: "default", variant: "outline" },
  },
);

const DOT_TONE = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  accent: "bg-accent",
  muted: "bg-muted-foreground",
} as const;

// The filled variant's tint and text, per tone.
//
// TOKENS, never the handoff's raw oklch() literals. Its palette was read off
// the light theme, so writing those values in would give a board that is
// unreadable in dark mode — and the handoff says so itself: "use the vars".
// Opacity does the tinting, which both themes survive.
const FILL_TONE = {
  success: "bg-success/[0.12] text-success",
  warning: "bg-warning/[0.13] text-warning",
  destructive: "bg-destructive/10 text-destructive",
  accent: "bg-accent-subtle text-accent",
  // Inert states stay grey — colouring "On hold" would make a parked job as
  // loud as a live one.
  muted: "bg-secondary text-muted-foreground",
} as const;

export type StatusTone = keyof typeof DOT_TONE;

export function StatusCapsule({
  tone,
  size,
  variant,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof capsuleVariants> & { tone: StatusTone }) {
  return (
    <span
      data-slot="status-capsule"
      className={cn(
        capsuleVariants({ size, variant }),
        variant === "filled" && FILL_TONE[tone],
        className,
      )}
      {...props}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", DOT_TONE[tone])}
        aria-hidden
      />
      {children}
    </span>
  );
}
