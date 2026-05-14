"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

// Discord-style toggle: a pill-shaped track with a sliding thumb.
// Inputs are intentionally minimal so it can be driven either as a
// controlled component (pass `checked` + `onCheckedChange`) or
// uncontrolled with `defaultChecked`.
//
// Accessibility: rendered as a real <button role="switch"> with
// aria-checked, so screen readers and keyboard users get the standard
// toggle behaviour without any extra wiring.

type SwitchProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange"
> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (next: boolean) => void;
  // Optional label for screen readers when the visible label is
  // somewhere else in the DOM.
  ariaLabel?: string;
};

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch(
    {
      checked,
      defaultChecked,
      onCheckedChange,
      disabled,
      ariaLabel,
      className,
      ...rest
    },
    ref,
  ) {
    const isControlled = checked !== undefined;
    const [internal, setInternal] = React.useState(defaultChecked ?? false);
    const value = isControlled ? Boolean(checked) : internal;

    function toggle() {
      if (disabled) return;
      const next = !value;
      if (!isControlled) setInternal(next);
      onCheckedChange?.(next);
    }

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={toggle}
        onKeyDown={(e) => {
          // Space + Enter both flip. Browsers already do this for
          // buttons; we keep the explicit handler so screen readers
          // that send a different keycode for "switch" still work.
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggle();
          }
        }}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent",
          "transition-colors duration-200 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-50",
          value ? "bg-foreground" : "bg-muted",
          className,
        )}
        {...rest}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-sm ring-1 ring-border",
            "transition-transform duration-200 ease-out",
            value ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    );
  },
);
