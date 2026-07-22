"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

export type SegmentOption<T extends string> = { value: T; label: string };

// A small radiogroup segmented control with a single pill that SLIDES between
// options (shared-element layout animation). Used for the range selector and
// the per-chart view toggle. Keyboard + screen-reader friendly; the pill jumps
// instantly under prefers-reduced-motion.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  disabled = false,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const reduce = useReducedMotion();
  const groupId = useId();

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-muted/50 p-0.5",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(opt.value)}
            className={cn(
              "relative z-10 cursor-pointer rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm"
                ? "px-3 py-1.5 text-xs"
                : "px-3.5 py-2 text-sm",
              active
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`segpill-${groupId}`}
                className="absolute inset-0 -z-10 rounded-full bg-primary shadow-sm"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 480, damping: 38 }
                }
              />
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
