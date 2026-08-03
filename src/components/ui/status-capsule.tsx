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

const capsuleVariants = cva(
  "inline-flex w-fit shrink-0 items-center rounded-full border border-border font-medium whitespace-nowrap",
  {
    variants: {
      size: {
        // Home rows and the Filing-settings hero.
        default: "gap-1.5 py-0.5 pr-2.5 pl-2 text-xs",
        // Browse rows, where the capsule sits inline beside a file name.
        sm: "gap-1.5 py-px pr-[9px] pl-[7px] text-[11.5px]",
      },
    },
    defaultVariants: { size: "default" },
  },
);

const DOT_TONE = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  accent: "bg-accent",
  muted: "bg-muted-foreground",
} as const;

export type StatusTone = keyof typeof DOT_TONE;

export function StatusCapsule({
  tone,
  size,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof capsuleVariants> & { tone: StatusTone }) {
  return (
    <span
      data-slot="status-capsule"
      className={cn(capsuleVariants({ size }), className)}
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
